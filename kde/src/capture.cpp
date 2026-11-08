#include "capture.h"
#include "highlighter.h"
#include "kwinbridge.h"
#include "linkpreview.h"
#include "settings.h"
#include "util.h"

#include <KSystemClipboard>

#include <QBuffer>
#include <QDateTime>
#include <QFile>
#include <QImage>
#include <QImageReader>
#include <QMimeData>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QUrl>

// GIF first so animations survive; then the formats Copyous accepts.
static const QStringList IMAGE_MIMES = {
    QStringLiteral("image/gif"), QStringLiteral("image/png"), QStringLiteral("image/webp"), QStringLiteral("image/avif"),
    QStringLiteral("image/jxl"), QStringLiteral("image/jpeg"), QStringLiteral("image/bmp"), QStringLiteral("image/tiff"),
};
static const QString GNOME_FILES = QStringLiteral("x-special/gnome-copied-files");
static const QString URI_LIST = QStringLiteral("text/uri-list");
static const qint64 MAX_IMAGE_BYTES = 40 * 1024 * 1024;
static const int DEBOUNCE_MS = 80;
static const int OWN_COPY_MS = 1000;

static qint64 now()
{
    return QDateTime::currentMSecsSinceEpoch();
}

static bool isFileType(const QString &t)
{
    return t == QLatin1String("file") || t == QLatin1String("files");
}

Capture::Capture(Store *store, Settings *settings, Highlighter *highlighter, LinkPreview *links, KWinBridge *kwin, QObject *parent)
    : QObject(parent)
    , m_store(store)
    , m_settings(settings)
    , m_highlighter(highlighter)
    , m_links(links)
    , m_kwin(kwin)
    , m_clipboard(KSystemClipboard::instance())
{
    m_debounce.setSingleShot(true);
    m_debounce.setInterval(DEBOUNCE_MS);
    connect(&m_debounce, &QTimer::timeout, this, &Capture::read);
    connect(m_clipboard, &KSystemClipboard::changed, this, [this](QClipboard::Mode mode) {
        if (mode != QClipboard::Clipboard)
            return;
        m_curType.clear();
        m_curHash.clear();
        m_debounce.start();
    });
}

bool Capture::shouldSave(const QStringList &formats) const
{
    if (m_settings->boolValue(QStringLiteral("incognito")))
        return false;
    if (formats.contains(QStringLiteral("x-kde-passwordManagerHint")))
        return false;
    const QStringList excluded = m_settings->excludedApps();
    if (!excluded.isEmpty()) {
        const QStringList cls = m_kwin->activeClass().split(QLatin1Char(' '), Qt::SkipEmptyParts);
        for (const QString &e : excluded) {
            if (cls.contains(e))
                return false;
        }
    }
    return true;
}

void Capture::read()
{
    if (paused)
        return;
    const QMimeData *md = m_clipboard->mimeData(QClipboard::Clipboard);
    if (!md)
        return;
    const QStringList formats = md->formats();
    if (formats.isEmpty())
        return;
    // A sound for every copy the user makes (not when we set the clipboard ourselves).
    if (now() > m_ownCopyUntil) {
        playSound();
        Q_EMIT userCopied();
    }
    if (!shouldSave(formats))
        return;

    const bool hasText = md->hasText();
    // Files win (file managers also offer the path as text); then images; then text.
    if (formats.contains(URI_LIST) || formats.contains(GNOME_FILES)) {
        QString op = QStringLiteral("copy");
        QStringList uris;
        if (formats.contains(GNOME_FILES)) {
            QStringList lines = QString::fromUtf8(md->data(GNOME_FILES)).split(QRegularExpression(QStringLiteral("\r?\n")), Qt::SkipEmptyParts);
            if (!lines.isEmpty() && (lines.first() == QLatin1String("copy") || lines.first() == QLatin1String("cut")))
                op = lines.takeFirst();
            uris = lines;
        }
        if (uris.isEmpty()) {
            for (const QUrl &u : md->urls())
                uris << u.toString(QUrl::FullyEncoded);
            if (md->data(QStringLiteral("application/x-kde-cutselection")) == "1")
                op = QStringLiteral("cut");
        }
        static const QRegularExpression scheme(QStringLiteral("^[a-z][a-z0-9+.-]*:"), QRegularExpression::CaseInsensitiveOption);
        uris = uris.filter(scheme);
        if (!uris.isEmpty()) {
            Item e;
            e.type = uris.size() == 1 ? QStringLiteral("file") : QStringLiteral("files");
            e.content = uris.join(QLatin1Char('\n'));
            e.hash = Util::md5(e.content.toUtf8());
            e.meta[QStringLiteral("op")] = op;
            return queueReady(e);
        }
    }
    for (const QString &mime : IMAGE_MIMES) {
        if (!formats.contains(mime))
            continue;
        const QByteArray bytes = md->data(mime);
        if (bytes.isEmpty() || bytes.size() > MAX_IMAGE_BYTES)
            return;
        Item e;
        e.type = QStringLiteral("image");
        e.mime = mime;
        e.hash = Util::md5(bytes);
        QString ext = mime.section(QLatin1Char('/'), 1);
        ext.replace(QLatin1String("jpeg"), QLatin1String("jpg"));
        e.content = QStringLiteral("%1.%2").arg(e.hash, ext);
        const QString path = Util::imageDir() + QLatin1Char('/') + e.content;
        if (!QFile::exists(path) && !Util::writePrivateFile(path, bytes)) {
            qWarning("copy-addict: could not save an image");
            return;
        }
        e.meta[QStringLiteral("bytes")] = bytes.size();
        QBuffer buf;
        buf.setData(bytes);
        QImageReader reader(&buf);
        const QSize size = reader.size();
        if (size.isValid()) {
            e.meta[QStringLiteral("width")] = size.width();
            e.meta[QStringLiteral("height")] = size.height();
        }
        if (mime == QLatin1String("image/gif") || mime == QLatin1String("image/webp"))
            e.meta[QStringLiteral("animated")] = reader.supportsAnimation() && reader.imageCount() != 1;
        return queueReady(e);
    }
    if (hasText)
        queueText(md->text());
}

// Same order as Copyous: link, character, color, code, text.
void Capture::queueText(const QString &text)
{
    if (text.trimmed().isEmpty())
        return;
    Item e;
    e.content = text;
    e.hash = Util::md5(text.toUtf8());
    const QString t = text.trimmed();
    if (Util::isLink(t))
        e.type = QStringLiteral("link");
    else if (Util::graphemeCount(t) <= 1)
        e.type = QStringLiteral("character");
    else if (Util::isColor(t))
        e.type = QStringLiteral("color");
    if (!e.type.isEmpty())
        return queueReady(e);

    auto job = std::make_shared<Job>();
    job->entry = e;
    m_jobs.append(job);
    m_highlighter->detect(text, [this, job](const QVariantMap &lang) {
        if (lang.isEmpty()) {
            job->entry.type = QStringLiteral("text");
        } else {
            job->entry.type = QStringLiteral("code");
            job->entry.meta[QStringLiteral("language")] = lang;
        }
        job->ready = true;
        flush();
    });
}

void Capture::queueReady(const Item &entry)
{
    auto job = std::make_shared<Job>();
    job->entry = entry;
    job->ready = true;
    m_jobs.append(job);
    flush();
}

void Capture::flush()
{
    while (!m_jobs.isEmpty() && m_jobs.first()->ready)
        save(m_jobs.takeFirst()->entry);
}

void Capture::save(const Item &entry)
{
    m_curType = entry.type;
    m_curHash = entry.hash;
    // Skip what we just put on the clipboard ourselves, and repeats of the same copy.
    if (entry.hash == m_prevHash && (entry.type == m_prevType || (!isFileType(entry.type) && !isFileType(m_prevType)
                                                                   && entry.type != QLatin1String("image") && m_prevType != QLatin1String("image"))))
        return;
    // A file manager often re-offers a copied file as plain text: ignore that echo.
    if (isFileType(m_prevType) && !isFileType(entry.type) && m_prevPaths.contains(entry.content.trimmed()))
        return;
    m_prevType = entry.type;
    m_prevHash = entry.hash;
    m_prevPaths.clear();
    if (isFileType(entry.type)) {
        for (const QString &u : entry.content.split(QLatin1Char('\n'))) {
            const QString p = Util::uriToPath(u);
            m_prevPaths << (p.isEmpty() ? u : p);
        }
    }
    const auto r = m_store->add(entry);
    if (entry.type == QLatin1String("link"))
        m_links->ensure(r.id);
    if (r.isNew)
        Q_EMIT newItem(r.id);
}

void Capture::playSound()
{
    if (!m_settings->boolValue(QStringLiteral("copySound")))
        return;
    QString file = m_settings->stringValue(QStringLiteral("copySoundFile"));
    if (file.isEmpty() || !QFile::exists(file)) {
        file.clear();
        for (const QString &p : {QStringLiteral("/usr/share/sounds/Yaru/stereo/audio-volume-change.oga"),
                                 QStringLiteral("/usr/share/sounds/freedesktop/stereo/audio-volume-change.oga")}) {
            if (QFile::exists(p)) {
                file = p;
                break;
            }
        }
    }
    if (file.isEmpty())
        return;
    if (!QStandardPaths::findExecutable(QStringLiteral("pw-play")).isEmpty())
        QProcess::startDetached(QStringLiteral("pw-play"), {file});
    else
        QProcess::startDetached(QStringLiteral("paplay"), {file});
}

// ---------- put back ----------
bool Capture::copy(const QString &id)
{
    const Item *item = m_store->find(id);
    if (!item)
        return false;
    auto *md = new QMimeData;
    if (item->type == QLatin1String("image")) {
        QFile f(m_store->imagePath(*item));
        if (!f.open(QIODevice::ReadOnly)) {
            delete md;
            return false;
        }
        const QByteArray bytes = f.readAll();
        const QString mime = item->mime.isEmpty() ? QStringLiteral("image/png") : item->mime;
        md->setData(mime, bytes);
        // Offer PNG too: many apps take nothing else.
        if (mime != QLatin1String("image/png")) {
            QImage img;
            if (img.loadFromData(bytes)) {
                QByteArray png;
                QBuffer b(&png);
                b.open(QIODevice::WriteOnly);
                img.save(&b, "PNG");
                md->setData(QStringLiteral("image/png"), png);
            }
        }
    } else if (isFileType(item->type)) {
        QList<QUrl> urls;
        QStringList paths;
        for (const QString &u : item->content.split(QLatin1Char('\n'), Qt::SkipEmptyParts)) {
            urls << QUrl(u.trimmed());
            const QString p = Util::uriToPath(u.trimmed());
            paths << (p.isEmpty() ? u.trimmed() : p);
        }
        md->setUrls(urls);
        md->setData(GNOME_FILES, (QStringLiteral("copy\n") + item->content).toUtf8());
        md->setText(paths.join(QLatin1Char('\n')));
    } else {
        md->setText(item->content);
    }
    m_ownCopyUntil = now() + OWN_COPY_MS;
    m_prevType = item->type;
    m_prevHash = item->hash;
    m_curType = item->type;
    m_curHash = item->hash;
    const QString itemId = item->id;
    m_clipboard->setMimeData(md, QClipboard::Clipboard);
    m_store->touch(itemId);   // Copyous: update-date-on-copy
    return true;
}

void Capture::copyText(const QString &text)
{
    m_ownCopyUntil = now() + OWN_COPY_MS;
    m_prevType = QStringLiteral("text");
    m_prevHash = Util::md5(text.toUtf8());
    auto *md = new QMimeData;
    md->setText(text);
    m_clipboard->setMimeData(md, QClipboard::Clipboard);
}

bool Capture::isCurrent(const QString &id) const
{
    const Item *item = m_store->find(id);
    if (!item || item->type != m_curType || item->hash != m_curHash)
        return false;
    const QMimeData *md = m_clipboard->mimeData(QClipboard::Clipboard);
    return md && !md->formats().isEmpty();
}

void Capture::redetect(const QString &id)
{
    const Item *item = m_store->find(id);
    if (!item || item->type == QLatin1String("image") || isFileType(item->type))
        return;
    const QString text = item->content;
    const QString t = text.trimmed();
    auto apply = [this, id](const QString &type, const QVariantMap &lang) {
        const Item *it = m_store->find(id);
        if (!it)
            return;
        const QVariantMap oldLang = it->meta.value(QStringLiteral("language")).toMap();
        if (it->type == type && oldLang.value(QStringLiteral("id")) == lang.value(QStringLiteral("id")))
            return;
        QVariantMap meta = it->meta;
        if (type == QLatin1String("code"))
            meta[QStringLiteral("language")] = lang;
        else
            meta.remove(QStringLiteral("language"));
        m_store->update(id, {{QStringLiteral("type"), type}, {QStringLiteral("meta"), meta}});
        if (type == QLatin1String("link"))
            m_links->ensure(id);
    };
    if (Util::isLink(t))
        return apply(QStringLiteral("link"), {});
    if (Util::graphemeCount(t) <= 1)
        return apply(QStringLiteral("character"), {});
    if (Util::isColor(t))
        return apply(QStringLiteral("color"), {});
    m_highlighter->detect(text, [apply](const QVariantMap &lang) {
        apply(lang.isEmpty() ? QStringLiteral("text") : QStringLiteral("code"), lang);
    });
}

void Capture::redetectAll()
{
    QStringList ids;
    for (const Item &i : m_store->items()) {
        if (i.type == QLatin1String("text") || i.type == QLatin1String("code") || i.meta.value(QStringLiteral("needsDetect")).toBool())
            ids << i.id;
    }
    for (const QString &id : std::as_const(ids))
        redetect(id);
}
