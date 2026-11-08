#include "filtermodel.h"
#include "store.h"
#include "util.h"

FilterModel::FilterModel(QObject *parent)
    : QSortFilterProxyModel(parent)
{
    connect(this, &QAbstractItemModel::rowsInserted, this, &FilterModel::countChanged);
    connect(this, &QAbstractItemModel::rowsRemoved, this, &FilterModel::countChanged);
    connect(this, &QAbstractItemModel::modelReset, this, &FilterModel::countChanged);
    connect(this, &QAbstractItemModel::layoutChanged, this, &FilterModel::countChanged);
    // Pinning or tagging changes what the pinned/tag filters accept.
    setDynamicSortFilter(true);
}

void FilterModel::changed()
{
    beginFilterChange();
    endFilterChange(QSortFilterProxyModel::Direction::Rows);
    Q_EMIT filtersChanged();
    Q_EMIT countChanged();
}

void FilterModel::setSearch(const QString &s)
{
    if (s == m_search)
        return;
    m_search = s;
    m_folded = Util::fold(s.trimmed());
    changed();
}

void FilterModel::setTypeFilter(const QString &t)
{
    if (t == m_type)
        return;
    m_type = t;
    changed();
}

void FilterModel::setTagFilter(const QString &t)
{
    if (t == m_tag)
        return;
    m_tag = t;
    changed();
}

void FilterModel::setPinnedOnly(bool on)
{
    if (on == m_pinnedOnly)
        return;
    m_pinnedOnly = on;
    changed();
}

void FilterModel::reset()
{
    m_search.clear();
    m_folded.clear();
    m_type.clear();
    m_tag.clear();
    m_pinnedOnly = false;
    changed();
}

QString FilterModel::idAt(int row) const
{
    return data(index(row, 0), Store::IdRole).toString();
}

int FilterModel::rowOf(const QString &id) const
{
    for (int i = 0; i < rowCount(); ++i) {
        if (idAt(i) == id)
            return i;
    }
    return -1;
}

bool FilterModel::filterAcceptsRow(int sourceRow, const QModelIndex &sourceParent) const
{
    const QModelIndex idx = sourceModel()->index(sourceRow, 0, sourceParent);
    if (!m_type.isEmpty() && idx.data(Store::TypeRole).toString() != m_type)
        return false;
    if (!m_tag.isEmpty() && idx.data(Store::TagRole).toString() != m_tag)
        return false;
    if (m_pinnedOnly && !idx.data(Store::PinnedRole).toBool())
        return false;
    if (m_folded.isEmpty())
        return true;
    return idx.data(Store::SearchTextRole).toString().contains(m_folded);
}
