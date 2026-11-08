// Link previews: title, description and image (Open Graph / Twitter / <title>).
#pragma once

#include <QObject>
#include <QSet>

#include <functional>

class QNetworkAccessManager;
class QNetworkReply;
class Store;

class LinkPreview : public QObject
{
    Q_OBJECT
public:
    explicit LinkPreview(Store *store, QObject *parent = nullptr);

    // Fetch once per item; the result goes to item.meta.link.
    void ensure(const QString &itemId);

private:
    using Done = std::function<void(const QByteArray &body, const QString &contentType)>;
    void get(const QString &url, qint64 maxBytes, Done done);
    QString storeImage(const QString &url, const QByteArray &bytes);
    void finish(const QString &itemId, const QVariantMap &link);

    Store *m_store;
    QNetworkAccessManager *m_net;
    QSet<QString> m_pending;
};
