#include "linkpreview.h"
#include "store.h"
#include "util.h"

#include <QDir>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QUrl>

static const qint64 MAX_HTML_BYTES = 768 * 1024;
static const qint64 MAX_IMAGE_BYTES = 8 * 1024 * 1024;
static const int TIMEOUT_MS = 12000;

static QString linkDir()
{
    return Util::cacheDir() + QStringLiteral("/links");
}

static QString decodeEntities(QString s)
{
    static const QRegularExpression re(QStringLiteral("&(#x[0-9a-f]+|#\\d+|amp|lt|gt|quot|apos|nbsp);"), QRegularExpression::CaseInsensitiveOption);
    QString out;
    qsizetype last = 0;
    auto it = re.globalMatch(s);
    while (it.hasNext()) {
        const auto m = it.next();
        out += s.mid(last, m.capturedStart() - last);
        const QString e = m.captured(1).toLower();
        if (e == QLatin1String("amp"))
            out += QLatin1Char('&');
        else if (e == QLatin1String("lt"))
            out += QLatin1Char('<');
        else if (e == QLatin1String("gt"))
            out += QLatin1Char('>');
        else if (e == QLatin1String("quot"))
            out += QLatin1Char('"');
        else if (e == QLatin1String("apos"))
            out += QLatin1Char('\'');
        else if (e == QLatin1String("nbsp"))
            out += QLatin1Char(' ');
        else {
            bool ok = false;
            const uint code = e.startsWith(QLatin1String("#x")) ? e.mid(2).toUInt(&ok, 16) : e.mid(1).toUInt(&ok, 10);
            const char32_t c = char32_t(code);
            out += ok && code > 0 && code < 0x110000 ? QString::fromUcs4(&c, 1) : m.captured(0);
        }
        last = m.capturedEnd();
    }
    out += s.mid(last);
    return out.simplified();
}

static QString metaContent(const QString &html, const QStringList &names)
{
    for (const QString &name : names) {
        const QString n = QRegularExpression::escape(name);
        const QRegularExpression re1(
            QStringLiteral("<meta[^>]+(?:property|name|itemprop)\\s*=\\s*[\"']%1[\"'][^>]*content\\s*=\\s*[\"']([^\"']*)[\"']").arg(n),
            QRegularExpression::CaseInsensitiveOption);
        const QRegularExpression re2(
            QStringLiteral("<meta[^>]+content\\s*=\\s*[\"']([^\"']*)[\"'][^>]*(?:property|name|itemprop)\\s*=\\s*[\"']%1[\"']").arg(n),
            QRegularExpression::CaseInsensitiveOption);
        auto m = re1.match(html);
        if (!m.hasMatch())
            m = re2.match(html);
        if (m.hasMatch() && !m.captured(1).trimmed().isEmpty())
            return decodeEntities(m.captured(1));
    }
    return {};
}

LinkPreview::LinkPreview(Store *store, QObject *parent)
    : QObject(parent)
    , m_store(store)
    , m_net(new QNetworkAccessManager(this))
{
    QDir().mkpath(linkDir());
    m_net->setTransferTimeout(TIMEOUT_MS);
    m_net->setRedirectPolicy(QNetworkRequest::NoLessSafeRedirectPolicy);
}

void LinkPreview::ensure(const QString &itemId)
{
    const Item *item = m_store->find(itemId);
    if (!item || item->type != QLatin1String("link") || item->meta.contains(QStringLiteral("link")) || m_pending.contains(itemId))
        return;
    const QString url = item->content.trimmed();
    m_pending.insert(itemId);
    get(url, MAX_HTML_BYTES, [this, itemId, url](const QByteArray &body, const QString &ctype) {
        QVariantMap link{{QStringLiteral("title"), QVariant()}, {QStringLiteral("description"), QVariant()},
                         {QStringLiteral("image"), QVariant()}, {QStringLiteral("imageFile"), QVariant()}};
        if (!body.isEmpty() && ctype.startsWith(QLatin1String("image/"))) {
            // The URL itself is an image: it is its own preview.
            link[QStringLiteral("imageFile")] = storeImage(url, body);
            return finish(itemId, link);
        }
        QString image;
        if (!body.isEmpty()) {
            const QString head = QString::fromUtf8(body.left(300000));
            QString title = metaContent(head, {QStringLiteral("og:title"), QStringLiteral("twitter:title"), QStringLiteral("title")});
            if (title.isEmpty()) {
                static const QRegularExpression t(QStringLiteral("<title[^>]*>([\\s\\S]*?)</title>"), QRegularExpression::CaseInsensitiveOption);
                const auto m = t.match(head);
                if (m.hasMatch())
                    title = decodeEntities(m.captured(1));
            }
            if (!title.isEmpty())
                link[QStringLiteral("title")] = title;
            const QString desc = metaContent(head, {QStringLiteral("og:description"), QStringLiteral("twitter:description"), QStringLiteral("description")});
            if (!desc.isEmpty())
                link[QStringLiteral("description")] = desc;
            const QString img = metaContent(head, {QStringLiteral("og:image"), QStringLiteral("og:image:url"), QStringLiteral("og:image:secure_url"),
                                                   QStringLiteral("twitter:image"), QStringLiteral("twitter:image:src"), QStringLiteral("image")});
            if (!img.isEmpty()) {
                image = QUrl(url).resolved(QUrl(img)).toString();
                link[QStringLiteral("image")] = image;
            }
        }
        if (image.isEmpty())
            return finish(itemId, link);
        get(image, MAX_IMAGE_BYTES, [this, itemId, link, image](const QByteArray &imgBody, const QString &imgType) mutable {
            if (!imgBody.isEmpty() && imgType.startsWith(QLatin1String("image/")))
                link[QStringLiteral("imageFile")] = storeImage(image, imgBody);
            finish(itemId, link);
        });
    });
}

void LinkPreview::get(const QString &url, qint64 maxBytes, Done done)
{
    QNetworkRequest req{QUrl(url)};
    req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) copy-addict/2.0 (link preview)"));
    req.setRawHeader("Accept", "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5");
    QNetworkReply *reply = m_net->get(req);
    auto buffer = std::make_shared<QByteArray>();
    connect(reply, &QNetworkReply::readyRead, reply, [reply, buffer, maxBytes]() {
        buffer->append(reply->read(maxBytes - buffer->size() + 1));
        if (buffer->size() > maxBytes) {
            buffer->truncate(maxBytes);
            reply->abort();
        }
    });
    connect(reply, &QNetworkReply::finished, this, [reply, buffer, maxBytes, done]() {
        reply->deleteLater();
        if (buffer->size() < maxBytes)
            buffer->append(reply->read(maxBytes - buffer->size()));
        const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool truncated = reply->error() == QNetworkReply::OperationCanceledError && !buffer->isEmpty();
        if ((reply->error() != QNetworkReply::NoError && !truncated) || code < 200 || code >= 300)
            return done({}, {});
        const QString ctype = reply->header(QNetworkRequest::ContentTypeHeader).toString().section(QLatin1Char(';'), 0, 0).trimmed().toLower();
        done(*buffer, ctype);
    });
}

QString LinkPreview::storeImage(const QString &url, const QByteArray &bytes)
{
    const QString name = Util::md5(url.toUtf8());
    QFile f(linkDir() + QLatin1Char('/') + name);
    if (!f.open(QIODevice::WriteOnly))
        return {};
    f.write(bytes);
    return name;
}

void LinkPreview::finish(const QString &itemId, const QVariantMap &link)
{
    m_pending.remove(itemId);
    const Item *item = m_store->find(itemId);
    if (!item)
        return;
    QVariantMap meta = item->meta;
    meta[QStringLiteral("link")] = link;
    m_store->update(itemId, {{QStringLiteral("meta"), meta}});
}
