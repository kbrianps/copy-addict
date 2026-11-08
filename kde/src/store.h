// History storage and list model: items in history.json, images as files next to it.
// Same file format as the Cinnamon extension (version 2), so the history carries over.
#pragma once

#include <QAbstractListModel>
#include <QHash>
#include <QJsonObject>
#include <QTimer>
#include <QVariantMap>

class Settings;
class Highlighter;

struct Item {
    QString id;
    QString type;       // text code link image file files color character
    QString content;    // text, image file name, or newline separated URIs
    QString mime;       // images only
    QString hash;
    QString title;      // custom title, empty = default
    QString tag;        // tag id, empty = none
    bool pinned = false;
    qint64 time = 0;    // ms since epoch, last copy or use
    QVariantMap meta;   // language, link preview, image size...

    QJsonObject toJson() const;
    static bool fromJson(const QJsonObject &o, Item &out);
};

struct Tag {
    QString id;
    QString name;
    QString color;
};

class Store : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)
public:
    enum Roles {
        IdRole = Qt::UserRole + 1,
        TypeRole,
        ContentRole,
        TitleRole,          // custom title or ""
        DisplayTitleRole,   // custom title or type name (plus language for code)
        TimeRole,
        PinnedRole,
        TagRole,
        TagColorRole,
        ProtectedRole,
        ViewRole,           // type-specific preview data (QVariantMap)
        CodeHtmlRole,       // highlighted code (code items and text file previews)
        SearchTextRole,     // folded text used by the search box
    };

    explicit Store(Settings *settings, QObject *parent = nullptr);
    ~Store() override;

    void setHighlighter(Highlighter *h);

    int rowCount(const QModelIndex &parent = {}) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    int count() const { return int(m_items.size()); }
    const QList<Item> &items() const { return m_items; }
    int indexOf(const QString &id) const;
    const Item *find(const QString &id) const;

    struct AddResult {
        QString id;
        bool isNew = false;
    };
    AddResult add(Item entry);
    void touch(const QString &id);
    void update(const QString &id, const QVariantMap &changes);
    void remove(const QString &id);
    void clear(bool includeProtected);
    int trim();

    bool isProtected(const Item &item) const;
    QString imagePath(const Item &item) const;
    QString linkImagePath(const Item &item) const;
    QStringList paths(const Item &item) const;   // local paths of file(s) and images

    static const QList<Tag> &tags();
    static const Tag *tagById(const QString &id);
    static QString typeName(const QString &type);
    static QString typeIcon(const QString &type);
    static QStringList typeOrder();

    void save();
    void saveNow();
    void refreshAll();          // relayout after a settings change
    void warmHighlights();      // render code previews in the background

Q_SIGNALS:
    void countChanged();
    void changed();

private:
    void load();
    void cleanOrphanImages();
    void deleteFiles(const Item &item);
    void moveToFront(int row);
    void removeRow_(int row);
    void invalidate(const QString &id);
    QVariantMap view(const Item &item) const;
    QVariantMap fileView(const Item &item) const;
    QVariantMap filesView(const Item &item) const;
    QString codeHtml(const Item &item) const;
    QString searchText(const Item &item) const;

    Settings *m_settings;
    Highlighter *m_highlighter = nullptr;
    QList<Item> m_items;
    QTimer m_saveTimer;
    mutable QHash<QString, QVariantMap> m_viewCache;
    mutable QHash<QString, QString> m_searchCache;
};
