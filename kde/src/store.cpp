#include "store.h"
#include "highlighter.h"
#include "settings.h"
#include "util.h"

#include <KLocalizedString>

#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImageReader>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMimeDatabase>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QSet>
#include <QStandardPaths>
#include <QUrl>

static const int SAVE_DELAY_MS = 250;
static const int TEXT_PREVIEW_CHARS = 1500;
static const int FILE_TEXT_PREVIEW_BYTES = 4096;
static const int FILES_SHOWN = 5;

static QString historyFile()
{
    return Util::dataDir() + QStringLiteral("/history.json");
}

static QString newId()
{
    static int counter = 0;
    counter = (counter + 1) % 100000;
    return QStringLiteral("%1-%2-%3")
        .arg(QString::number(QDateTime::currentMSecsSinceEpoch(), 36), QString::number(counter, 36),
             QString::number(QRandomGenerator::global()->bounded(1000000), 36));
}

static QString fileUrl(const QString &path)
{
    return QUrl::fromLocalFile(path).toString();
}

// ---------- Item ----------
QJsonObject Item::toJson() const
{
    QJsonObject o{
        {QStringLiteral("id"), id},
        {QStringLiteral("type"), type},
        {QStringLiteral("content"), content},
        {QStringLiteral("hash"), hash},
        {QStringLiteral("pinned"), pinned},
        {QStringLiteral("tag"), tag.isEmpty() ? QJsonValue() : QJsonValue(tag)},
        {QStringLiteral("title"), title.isEmpty() ? QJsonValue() : QJsonValue(title)},
        {QStringLiteral("time"), double(time)},
        {QStringLiteral("meta"), QJsonObject::fromVariantMap(meta)},
    };
    if (!mime.isEmpty())
        o.insert(QStringLiteral("mime"), mime);
    return o;
}

bool Item::fromJson(const QJsonObject &o, Item &out)
{
    if (!o.value(QStringLiteral("content")).isString() || o.value(QStringLiteral("type")).toString().isEmpty())
        return false;
    out.id = o.value(QStringLiteral("id")).toString();
    if (out.id.isEmpty())
        out.id = newId();
    out.type = o.value(QStringLiteral("type")).toString();
    out.content = o.value(QStringLiteral("content")).toString();
    out.mime = o.value(QStringLiteral("mime")).toString();
    out.hash = o.value(QStringLiteral("hash")).toString();
    if (out.hash.isEmpty())
        out.hash = Util::md5(out.content.toUtf8());
    out.title = o.value(QStringLiteral("title")).toString();
    out.tag = o.value(QStringLiteral("tag")).toString();
    out.pinned = o.value(QStringLiteral("pinned")).toBool();
    out.time = qint64(o.value(QStringLiteral("time")).toDouble());
    out.meta = o.value(QStringLiteral("meta")).toObject().toVariantMap();
    return true;
}

// ---------- tags and types ----------
const QList<Tag> &Store::tags()
{
    static const QList<Tag> list = {
        {QStringLiteral("blue"), i18n("Blue"), QStringLiteral("#3584e4")},
        {QStringLiteral("teal"), i18n("Teal"), QStringLiteral("#2190a4")},
        {QStringLiteral("green"), i18n("Green"), QStringLiteral("#3a944a")},
        {QStringLiteral("yellow"), i18n("Yellow"), QStringLiteral("#c88800")},
        {QStringLiteral("orange"), i18n("Orange"), QStringLiteral("#ed5b00")},
        {QStringLiteral("red"), i18n("Red"), QStringLiteral("#e62d42")},
        {QStringLiteral("pink"), i18n("Pink"), QStringLiteral("#d56199")},
        {QStringLiteral("purple"), i18n("Purple"), QStringLiteral("#9c3cbe")},
        {QStringLiteral("slate"), i18n("Slate"), QStringLiteral("#6f8396")},
    };
    return list;
}

const Tag *Store::tagById(const QString &id)
{
    for (const Tag &t : tags()) {
        if (t.id == id)
            return &t;
    }
    return nullptr;
}

QString Store::typeName(const QString &type)
{
    if (type == QLatin1String("code"))
        return i18n("Code");
    if (type == QLatin1String("link"))
        return i18n("Link");
    if (type == QLatin1String("image"))
        return i18n("Image");
    if (type == QLatin1String("file"))
        return i18n("File");
    if (type == QLatin1String("files"))
        return i18n("Files");
    if (type == QLatin1String("color"))
        return i18n("Color");
    if (type == QLatin1String("character"))
        return i18n("Character");
    return i18n("Text");
}

QString Store::typeIcon(const QString &type)
{
    static const QHash<QString, QString> icons = {
        {QStringLiteral("text"), QStringLiteral("format-justify-left-symbolic")},
        {QStringLiteral("code"), QStringLiteral("utilities-terminal-symbolic")},
        {QStringLiteral("link"), QStringLiteral("insert-link-symbolic")},
        {QStringLiteral("image"), QStringLiteral("image-x-generic-symbolic")},
        {QStringLiteral("file"), QStringLiteral("text-x-generic-symbolic")},
        {QStringLiteral("files"), QStringLiteral("folder-documents-symbolic")},
        {QStringLiteral("color"), QStringLiteral("applications-graphics-symbolic")},
        {QStringLiteral("character"), QStringLiteral("accessories-character-map-symbolic")},
    };
    return icons.value(type, icons.value(QStringLiteral("text")));
}

QStringList Store::typeOrder()
{
    return {QStringLiteral("text"), QStringLiteral("code"), QStringLiteral("image"), QStringLiteral("file"),
            QStringLiteral("files"), QStringLiteral("link"), QStringLiteral("character"), QStringLiteral("color")};
}

// ---------- Store ----------
Store::Store(Settings *settings, QObject *parent)
    : QAbstractListModel(parent)
    , m_settings(settings)
{
    QDir().mkpath(Util::imageDir());
    QDir().mkpath(Util::cacheDir());
    QFile::setPermissions(Util::dataDir(), QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner);
    QFile::setPermissions(Util::imageDir(), QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner);
    m_saveTimer.setSingleShot(true);
    m_saveTimer.setInterval(SAVE_DELAY_MS);
    connect(&m_saveTimer, &QTimer::timeout, this, &Store::saveNow);
    load();
    if (trim())
        save();
    cleanOrphanImages();
}

Store::~Store()
{
    if (m_saveTimer.isActive())
        saveNow();
}

void Store::setHighlighter(Highlighter *h)
{
    m_highlighter = h;
    connect(h, &Highlighter::rendered, this, [this]() {
        if (!m_items.isEmpty())
            Q_EMIT dataChanged(index(0), index(int(m_items.size()) - 1), {CodeHtmlRole});
    });
}

void Store::load()
{
    QFile f(historyFile());
    if (!f.exists() || !f.open(QIODevice::ReadOnly))
        return;
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(f.readAll(), &err);
    f.close();
    if (err.error != QJsonParseError::NoError) {
        qWarning("copy-addict: history.json is broken (%s), keeping a copy", qPrintable(err.errorString()));
        QFile::remove(historyFile() + QStringLiteral(".broken"));
        QFile::rename(historyFile(), historyFile() + QStringLiteral(".broken"));
        return;
    }
    const QJsonObject root = doc.object();
    const int version = root.value(QStringLiteral("version")).toInt(1);
    for (const QJsonValue &v : root.value(QStringLiteral("items")).toArray()) {
        QJsonObject o = v.toObject();
        if (version < 2) {   // v1: { type, text | image, hash, pinned, time }
            if (o.value(QStringLiteral("type")).toString() == QLatin1String("text"))
                o.insert(QStringLiteral("content"), o.value(QStringLiteral("text")));
            else if (o.value(QStringLiteral("type")).toString() == QLatin1String("image"))
                o.insert(QStringLiteral("content"), o.value(QStringLiteral("image")));
        }
        Item item;
        if (Item::fromJson(o, item))
            m_items.append(item);
    }
    std::stable_sort(m_items.begin(), m_items.end(), [](const Item &a, const Item &b) { return a.time > b.time; });
}

void Store::save()
{
    m_saveTimer.start();
}

void Store::saveNow()
{
    m_saveTimer.stop();
    QJsonArray arr;
    for (const Item &i : std::as_const(m_items))
        arr.append(i.toJson());
    const QJsonObject root{{QStringLiteral("version"), 2}, {QStringLiteral("items"), arr}};
    if (!Util::writePrivateFile(historyFile(), QJsonDocument(root).toJson(QJsonDocument::Compact)))
        qWarning("copy-addict: could not save the history");
}

int Store::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : int(m_items.size());
}

QHash<int, QByteArray> Store::roleNames() const
{
    return {
        {IdRole, "itemId"},
        {TypeRole, "type"},
        {ContentRole, "content"},
        {TitleRole, "customTitle"},
        {DisplayTitleRole, "displayTitle"},
        {TimeRole, "time"},
        {PinnedRole, "pinned"},
        {TagRole, "tag"},
        {TagColorRole, "tagColor"},
        {ProtectedRole, "isProtected"},
        {ViewRole, "view"},
        {CodeHtmlRole, "codeHtml"},
        {SearchTextRole, "searchText"},
    };
}

QVariant Store::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_items.size())
        return {};
    const Item &item = m_items.at(index.row());
    switch (role) {
    case IdRole:
        return item.id;
    case TypeRole:
        return item.type;
    case ContentRole:
        return item.content;
    case TitleRole:
        return item.title;
    case DisplayTitleRole: {
        if (!item.title.isEmpty())
            return item.title;
        const QString name = typeName(item.type);
        const QVariantMap lang = item.meta.value(QStringLiteral("language")).toMap();
        if (item.type == QLatin1String("code") && !lang.value(QStringLiteral("name")).toString().isEmpty())
            return QStringLiteral("%1 · %2").arg(name, lang.value(QStringLiteral("name")).toString());
        return name;
    }
    case TimeRole:
        return double(item.time);
    case PinnedRole:
        return item.pinned;
    case TagRole:
        return item.tag;
    case TagColorRole: {
        const Tag *t = tagById(item.tag);
        return t ? t->color : QString();
    }
    case ProtectedRole:
        return isProtected(item);
    case ViewRole: {
        auto it = m_viewCache.constFind(item.id);
        if (it != m_viewCache.constEnd())
            return *it;
        const QVariantMap v = view(item);
        m_viewCache.insert(item.id, v);
        return v;
    }
    case CodeHtmlRole:
        return codeHtml(item);
    case SearchTextRole: {
        auto it = m_searchCache.constFind(item.id);
        if (it != m_searchCache.constEnd())
            return *it;
        const QString s = searchText(item);
        m_searchCache.insert(item.id, s);
        return s;
    }
    }
    return {};
}

int Store::indexOf(const QString &id) const
{
    for (int i = 0; i < m_items.size(); ++i) {
        if (m_items.at(i).id == id)
            return i;
    }
    return -1;
}

const Item *Store::find(const QString &id) const
{
    const int i = indexOf(id);
    return i >= 0 ? &m_items.at(i) : nullptr;
}

bool Store::isProtected(const Item &item) const
{
    return (m_settings->boolValue(QStringLiteral("protectPinned")) && item.pinned)
        || (m_settings->boolValue(QStringLiteral("protectTagged")) && !item.tag.isEmpty());
}

QString Store::imagePath(const Item &item) const
{
    return Util::imageDir() + QLatin1Char('/') + item.content;
}

QString Store::linkImagePath(const Item &item) const
{
    const QString f = item.meta.value(QStringLiteral("link")).toMap().value(QStringLiteral("imageFile")).toString();
    return f.isEmpty() ? QString() : Util::cacheDir() + QStringLiteral("/links/") + f;
}

QStringList Store::paths(const Item &item) const
{
    if (item.type == QLatin1String("image"))
        return {imagePath(item)};
    QStringList out;
    for (const QString &u : item.content.split(QLatin1Char('\n'), Qt::SkipEmptyParts)) {
        const QString p = Util::uriToPath(u.trimmed());
        out << (p.isEmpty() ? u.trimmed() : p);
    }
    return out;
}

void Store::invalidate(const QString &id)
{
    m_viewCache.remove(id);
    m_searchCache.remove(id);
}

void Store::moveToFront(int row)
{
    if (row <= 0)
        return;
    beginMoveRows({}, row, row, {}, 0);
    m_items.move(row, 0);
    endMoveRows();
}

// Insert a new capture, or move an identical one to the front.
Store::AddResult Store::add(Item entry)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    for (int i = 0; i < m_items.size(); ++i) {
        Item &ex = m_items[i];
        if (ex.type == entry.type && ex.hash == entry.hash) {
            ex.time = now;
            for (auto it = entry.meta.cbegin(); it != entry.meta.cend(); ++it)
                ex.meta.insert(it.key(), it.value());
            invalidate(ex.id);
            const QString id = ex.id;
            Q_EMIT dataChanged(index(i), index(i));
            moveToFront(i);
            save();
            Q_EMIT changed();
            return {id, false};
        }
    }
    entry.id = newId();
    entry.time = now;
    beginInsertRows({}, 0, 0);
    m_items.prepend(entry);
    endInsertRows();
    trim();
    save();
    Q_EMIT countChanged();
    Q_EMIT changed();
    return {entry.id, true};
}

void Store::touch(const QString &id)
{
    const int i = indexOf(id);
    if (i < 0)
        return;
    m_items[i].time = QDateTime::currentMSecsSinceEpoch();
    Q_EMIT dataChanged(index(i), index(i), {TimeRole});
    moveToFront(i);
    save();
    Q_EMIT changed();
}

void Store::update(const QString &id, const QVariantMap &changes)
{
    int i = indexOf(id);
    if (i < 0)
        return;
    Item &item = m_items[i];
    for (auto it = changes.cbegin(); it != changes.cend(); ++it) {
        const QString &k = it.key();
        if (k == QLatin1String("content"))
            item.content = it.value().toString();
        else if (k == QLatin1String("hash"))
            item.hash = it.value().toString();
        else if (k == QLatin1String("type"))
            item.type = it.value().toString();
        else if (k == QLatin1String("meta"))
            item.meta = it.value().toMap();
        else if (k == QLatin1String("pinned"))
            item.pinned = it.value().toBool();
        else if (k == QLatin1String("tag"))
            item.tag = it.value().toString();
        else if (k == QLatin1String("title"))
            item.title = it.value().toString();
    }
    invalidate(id);
    Q_EMIT dataChanged(index(i), index(i));
    // Editing can make it identical to another item: keep the edited one.
    if (changes.contains(QStringLiteral("content"))) {
        const Item copy = m_items.at(i);
        for (int j = 0; j < m_items.size(); ++j) {
            if (j != i && m_items.at(j).type == copy.type && m_items.at(j).hash == copy.hash) {
                m_items[i].pinned = copy.pinned || m_items.at(j).pinned;
                if (m_items.at(i).tag.isEmpty())
                    m_items[i].tag = m_items.at(j).tag;
                removeRow_(j);
                break;
            }
        }
    }
    trim();
    save();
    Q_EMIT changed();
}

void Store::removeRow_(int row)
{
    const Item item = m_items.at(row);
    beginRemoveRows({}, row, row);
    m_items.removeAt(row);
    endRemoveRows();
    invalidate(item.id);
    deleteFiles(item);
    Q_EMIT countChanged();
}

void Store::remove(const QString &id)
{
    const int i = indexOf(id);
    if (i < 0)
        return;
    removeRow_(i);
    save();
    Q_EMIT changed();
}

void Store::clear(bool includeProtected)
{
    beginResetModel();
    QList<Item> removed, kept;
    for (const Item &i : std::as_const(m_items))
        (includeProtected || !(i.pinned || !i.tag.isEmpty()) ? removed : kept).append(i);
    m_items = kept;
    endResetModel();
    for (const Item &i : std::as_const(removed)) {
        invalidate(i.id);
        deleteFiles(i);
    }
    save();
    Q_EMIT countChanged();
    Q_EMIT changed();
}

int Store::trim()
{
    const int limit = m_settings->intValue(QStringLiteral("historyLength"));
    const int minutes = m_settings->intValue(QStringLiteral("historyMinutes"));
    const qint64 maxAge = minutes > 0 ? qint64(minutes) * 60000 : 0;
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    QList<int> drop;
    int kept = 0;
    for (int i = 0; i < m_items.size(); ++i) {
        const Item &it = m_items.at(i);
        if (it.pinned || !it.tag.isEmpty())
            continue;
        if (maxAge && now - it.time > maxAge) {
            drop << i;
            continue;
        }
        if (++kept > limit)
            drop << i;
    }
    for (int k = int(drop.size()) - 1; k >= 0; --k)
        removeRow_(drop.at(k));
    return int(drop.size());
}

void Store::deleteFiles(const Item &item)
{
    if (item.type != QLatin1String("image"))
        return;
    for (const Item &i : std::as_const(m_items)) {
        if (i.type == QLatin1String("image") && i.content == item.content)
            return;
    }
    QFile::remove(imagePath(item));
}

void Store::cleanOrphanImages()
{
    QSet<QString> used;
    for (const Item &i : std::as_const(m_items)) {
        if (i.type == QLatin1String("image"))
            used.insert(i.content);
    }
    QDir dir(Util::imageDir());
    for (const QString &name : dir.entryList(QDir::Files)) {
        if (!used.contains(name))
            dir.remove(name);
    }
}

void Store::refreshAll()
{
    m_viewCache.clear();
    m_searchCache.clear();
    if (!m_items.isEmpty())
        Q_EMIT dataChanged(index(0), index(int(m_items.size()) - 1));
}

void Store::warmHighlights()
{
    for (const Item &i : std::as_const(m_items)) {
        if (i.type == QLatin1String("code") || i.type == QLatin1String("file"))
            codeHtml(i);
    }
}

// ---------- previews ----------
static QString thumbnailFor(const QString &uri)
{
    const QString h = Util::md5(uri.toUtf8());
    const QString base = QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + QStringLiteral("/thumbnails/");
    for (const char *size : {"xx-large", "x-large", "large", "normal"}) {
        const QString p = base + QLatin1String(size) + QLatin1Char('/') + h + QStringLiteral(".png");
        if (QFile::exists(p))
            return p;
    }
    return {};
}

QVariantMap Store::view(const Item &item) const
{
    QVariantMap v;
    const QString &t = item.type;
    if (t == QLatin1String("image")) {
        const QString path = imagePath(item);
        v[QStringLiteral("exists")] = QFile::exists(path);
        v[QStringLiteral("source")] = fileUrl(path);
        v[QStringLiteral("animated")] = item.meta.value(QStringLiteral("animated")).toBool();
        const int w = item.meta.value(QStringLiteral("width")).toInt(), h = item.meta.value(QStringLiteral("height")).toInt();
        if (w && h) {
            v[QStringLiteral("info")] = QStringLiteral("%1×%2 · %3%4").arg(w).arg(h).arg(
                Util::humanSize(item.meta.value(QStringLiteral("bytes")).toLongLong()),
                v[QStringLiteral("animated")].toBool() ? QStringLiteral(" · GIF") : QString());
        }
    } else if (t == QLatin1String("link")) {
        const QVariantMap link = item.meta.value(QStringLiteral("link")).toMap();
        QString url = item.content.trimmed();
        url.remove(QRegularExpression(QStringLiteral("^https?://")));
        v[QStringLiteral("url")] = url;
        v[QStringLiteral("loaded")] = item.meta.contains(QStringLiteral("link"));
        v[QStringLiteral("title")] = link.value(QStringLiteral("title")).toString();
        v[QStringLiteral("description")] = link.value(QStringLiteral("description")).toString();
        const QString img = linkImagePath(item);
        v[QStringLiteral("image")] = !img.isEmpty() && QFile::exists(img) ? fileUrl(img) : QString();
    } else if (t == QLatin1String("file")) {
        return fileView(item);
    } else if (t == QLatin1String("files")) {
        return filesView(item);
    } else if (t == QLatin1String("color")) {
        const QColor c = Util::parseCssColor(item.content);
        v[QStringLiteral("text")] = item.content.trimmed();
        v[QStringLiteral("valid")] = c.isValid();
        if (c.isValid()) {
            v[QStringLiteral("color")] = c.name(QColor::HexArgb);
            const double lum = 0.2126 * c.redF() + 0.7152 * c.greenF() + 0.0722 * c.blueF();
            v[QStringLiteral("dark")] = lum >= 0.5 && c.alphaF() > 0.4;   // dark text on a light swatch
        }
    } else if (t == QLatin1String("character")) {
        const QString ch = item.content.trimmed();
        QStringList codes;
        for (const char32_t cp : ch.toUcs4())
            codes << QStringLiteral("U+") + QStringLiteral("%1").arg(uint(cp), 4, 16, QLatin1Char('0')).toUpper();
        v[QStringLiteral("char")] = ch;
        v[QStringLiteral("codes")] = codes.join(QLatin1Char(' '));
    } else if (t == QLatin1String("code")) {
        v[QStringLiteral("multiLine")] = item.content.trimmed().contains(QLatin1Char('\n'));
    } else {
        v[QStringLiteral("text")] = Util::normalizeText(item.content.left(TEXT_PREVIEW_CHARS));
    }
    return v;
}

QVariantMap Store::fileView(const Item &item) const
{
    QVariantMap v;
    const QString uri = item.content.trimmed();
    QString path = Util::uriToPath(uri);
    const QFileInfo fi(path);
    v[QStringLiteral("name")] = fi.fileName().isEmpty() ? uri : fi.fileName();
    if (path.isEmpty() || !fi.exists()) {
        v[QStringLiteral("preview")] = QStringLiteral("missing");
        v[QStringLiteral("path")] = Util::prettyPath(path.isEmpty() ? uri : path);
        return v;
    }
    const bool isDir = fi.isDir();
    static QMimeDatabase mimeDb;
    const QMimeType mt = mimeDb.mimeTypeForFile(fi);
    v[QStringLiteral("detail")] = QStringLiteral("%1 · %2").arg(Util::prettyPath(fi.absolutePath()), isDir ? i18n("Folder") : Util::humanSize(fi.size()));
    if (!isDir && mt.name().startsWith(QLatin1String("image/")) && QImageReader::supportedMimeTypes().contains(mt.name().toLatin1())) {
        v[QStringLiteral("preview")] = QStringLiteral("image");
        v[QStringLiteral("image")] = fileUrl(path);
        v[QStringLiteral("animated")] = mt.name() == QLatin1String("image/gif") || mt.name() == QLatin1String("image/webp");
        return v;
    }
    if (!isDir && mt.inherits(QStringLiteral("text/plain")) && fi.size() > 0) {
        v[QStringLiteral("preview")] = QStringLiteral("code");
        return v;
    }
    const QString thumb = thumbnailFor(QUrl::fromLocalFile(path).toString(QUrl::FullyEncoded));
    if (!thumb.isEmpty()) {
        v[QStringLiteral("preview")] = QStringLiteral("thumb");
        v[QStringLiteral("image")] = fileUrl(thumb);
        return v;
    }
    v[QStringLiteral("preview")] = QStringLiteral("icon");
    v[QStringLiteral("icon")] = isDir ? QStringLiteral("folder") : mt.iconName();
    v[QStringLiteral("fallbackIcon")] = isDir ? QStringLiteral("folder") : mt.genericIconName();
    return v;
}

QVariantMap Store::filesView(const Item &item) const
{
    const QStringList ps = paths(item);
    QList<QStringList> parts;
    for (const QString &p : ps)
        parts << p.split(QLatin1Char('/'));
    QStringList common;
    if (!parts.isEmpty()) {
        for (int i = 0; i < parts.first().size() - 1; ++i) {
            const QString seg = parts.first().at(i);
            bool all = true;
            for (const QStringList &p : std::as_const(parts)) {
                if (p.size() <= i + 1 || p.at(i) != seg) {
                    all = false;
                    break;
                }
            }
            if (!all)
                break;
            common << seg;
        }
    }
    QString base = common.join(QLatin1Char('/'));
    if (base.isEmpty())
        base = QStringLiteral("/");
    QVariantList rows;
    for (int i = 0; i < ps.size() && i < FILES_SHOWN; ++i) {
        QString name = ps.at(i).mid(base == QLatin1String("/") ? 1 : base.size());
        if (name.startsWith(QLatin1Char('/')))
            name.remove(0, 1);
        rows << QVariantMap{{QStringLiteral("name"), name}, {QStringLiteral("isDir"), QFileInfo(ps.at(i)).isDir()}};
    }
    return {
        {QStringLiteral("base"), Util::prettyPath(base)},
        {QStringLiteral("rows"), rows},
        {QStringLiteral("more"), qMax(0, int(ps.size()) - FILES_SHOWN)},
    };
}

QString Store::codeHtml(const Item &item) const
{
    if (!m_highlighter)
        return {};
    if (item.type == QLatin1String("code")) {
        const QString lang = item.meta.value(QStringLiteral("language")).toMap().value(QStringLiteral("id")).toString();
        const QString key = QStringLiteral("c:%1:%2").arg(item.hash, lang);
        return m_highlighter->html(key, Util::normalizeText(item.content.left(TEXT_PREVIEW_CHARS)), lang,
                                   item.content.trimmed().contains(QLatin1Char('\n')));
    }
    if (item.type == QLatin1String("file")) {
        const QVariantMap v = data(index(indexOf(item.id)), ViewRole).toMap();
        if (v.value(QStringLiteral("preview")).toString() != QLatin1String("code"))
            return {};
        const QString path = Util::uriToPath(item.content.trimmed());
        const QFileInfo fi(path);
        const QString key = QStringLiteral("f:%1:%2").arg(path).arg(fi.lastModified().toMSecsSinceEpoch());
        if (m_highlighter->hasHtml(key))
            return m_highlighter->html(key, {}, {}, true);
        QFile f(path);
        if (!f.open(QIODevice::ReadOnly))
            return {};
        const QString text = QString::fromUtf8(f.read(FILE_TEXT_PREVIEW_BYTES));
        return m_highlighter->html(key, Util::normalizeText(text), m_highlighter->languageForExtension(fi.suffix().toLower()), true);
    }
    return {};
}

QString Store::searchText(const Item &item) const
{
    QStringList fields{item.title};
    if (item.type == QLatin1String("file") || item.type == QLatin1String("files")) {
        for (const QString &p : paths(item))
            fields << p << Util::prettyPath(p);
    } else if (item.type != QLatin1String("image")) {
        fields << item.content;
        const QVariantMap link = item.meta.value(QStringLiteral("link")).toMap();
        fields << link.value(QStringLiteral("title")).toString() << link.value(QStringLiteral("description")).toString();
    }
    return Util::fold(fields.join(QLatin1Char('\n')));
}
