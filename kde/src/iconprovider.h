// image://icon/<name>[?color=rrggbb] : theme icons for QML, symbolic ones recoloured.
#pragma once

#include <QQuickImageProvider>

class IconProvider : public QQuickImageProvider
{
public:
    IconProvider();
    QPixmap requestPixmap(const QString &id, QSize *size, const QSize &requestedSize) override;
};
