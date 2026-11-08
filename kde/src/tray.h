// Tray icon (StatusNotifierItem) and its menu.
#pragma once

#include <QObject>
#include <QPointer>
#include <QTimer>

class App;
class KStatusNotifierItem;
class QAction;

class Tray : public QObject
{
    Q_OBJECT
public:
    explicit Tray(App *app);
    ~Tray() override;

    void sync();
    void flash();    // brief check mark when something is copied

private:
    App *m_app;
    QPointer<KStatusNotifierItem> m_sni;
    QAction *m_openAction = nullptr;
    QAction *m_incognitoAction = nullptr;
    QTimer m_flashTimer;
};
