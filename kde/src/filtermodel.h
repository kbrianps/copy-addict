// What the bar shows: the history filtered by search text, type, tag and pinned state.
#pragma once

#include <QSortFilterProxyModel>

class FilterModel : public QSortFilterProxyModel
{
    Q_OBJECT
    Q_PROPERTY(QString search READ search WRITE setSearch NOTIFY filtersChanged)
    Q_PROPERTY(QString typeFilter READ typeFilter WRITE setTypeFilter NOTIFY filtersChanged)
    Q_PROPERTY(QString tagFilter READ tagFilter WRITE setTagFilter NOTIFY filtersChanged)
    Q_PROPERTY(bool pinnedOnly READ pinnedOnly WRITE setPinnedOnly NOTIFY filtersChanged)
    Q_PROPERTY(bool filtering READ filtering NOTIFY filtersChanged)
    Q_PROPERTY(int count READ count NOTIFY countChanged)
public:
    explicit FilterModel(QObject *parent = nullptr);

    QString search() const { return m_search; }
    void setSearch(const QString &s);
    QString typeFilter() const { return m_type; }
    void setTypeFilter(const QString &t);
    QString tagFilter() const { return m_tag; }
    void setTagFilter(const QString &t);
    bool pinnedOnly() const { return m_pinnedOnly; }
    void setPinnedOnly(bool on);
    bool filtering() const { return !m_folded.isEmpty() || !m_type.isEmpty() || !m_tag.isEmpty() || m_pinnedOnly; }
    int count() const { return rowCount(); }

    Q_INVOKABLE QString idAt(int row) const;
    Q_INVOKABLE int rowOf(const QString &id) const;
    Q_INVOKABLE void reset();

Q_SIGNALS:
    void filtersChanged();
    void countChanged();

protected:
    bool filterAcceptsRow(int sourceRow, const QModelIndex &sourceParent) const override;

private:
    void changed();

    QString m_search, m_folded, m_type, m_tag;
    bool m_pinnedOnly = false;
};
