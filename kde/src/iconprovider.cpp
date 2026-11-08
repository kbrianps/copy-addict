#include "iconprovider.h"

#include <QIcon>
#include <QPainter>
#include <QUrlQuery>

IconProvider::IconProvider()
    : QQuickImageProvider(QQuickImageProvider::Pixmap)
{
}

QPixmap IconProvider::requestPixmap(const QString &id, QSize *size, const QSize &requestedSize)
{
    const qsizetype q = id.indexOf(QLatin1Char('?'));
    const QStringList names = (q < 0 ? id : id.left(q)).split(QLatin1Char('|'), Qt::SkipEmptyParts);
    const QUrlQuery query(q < 0 ? QString() : id.mid(q + 1));
    const int side = requestedSize.isValid() ? std::max(requestedSize.width(), requestedSize.height()) : 32;

    QIcon icon;
    for (const QString &n : names) {   // "a|b|c" tries each name in order
        icon = QIcon::fromTheme(n);
        if (!icon.isNull())
            break;
        if (n.endsWith(QLatin1String("-symbolic"))) {
            icon = QIcon::fromTheme(n.chopped(9));
            if (!icon.isNull())
                break;
        }
    }
    if (icon.isNull())
        icon = QIcon::fromTheme(QStringLiteral("unknown"));
    QPixmap pm = icon.pixmap(QSize(side, side));
    if (query.hasQueryItem(QStringLiteral("color"))) {
        QPainter p(&pm);
        p.setCompositionMode(QPainter::CompositionMode_SourceIn);
        p.fillRect(pm.rect(), QColor(QLatin1Char('#') + query.queryItemValue(QStringLiteral("color"))));
    }
    if (size)
        *size = pm.size();
    return pm;
}
