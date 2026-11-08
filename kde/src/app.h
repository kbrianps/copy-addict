// copy-addict for KDE Plasma: wires the clipboard capture, the history and the bar together.
// Also the D-Bus object (org.kbrianps.CopyAddict /CopyAddict) that the CLI and KWin talk to.
#pragma once

#include <QObject>
#include <QPointer>
#include <QTimer>
#include <QVariantList>

class QAction;
class QQmlApplicationEngine;
class QQuickWindow;
class Capture;
class FilterModel;
class Highlighter;
class KWinBridge;
class LinkPreview;
class Paster;
class Settings;
class Store;
class Tray;

class App : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.kbrianps.CopyAddict")
    Q_PROPERTY(bool isOpen READ isOpen NOTIFY openChanged)
    Q_PROPERTY(bool preview READ isPreview NOTIFY openChanged)
    Q_PROPERTY(QVariantList tags READ tags CONSTANT)
    Q_PROPERTY(QStringList typeOrder READ typeOrder CONSTANT)
    Q_PROPERTY(QString shortcutLabel READ shortcutLabel NOTIFY shortcutsChanged)
    Q_PROPERTY(QString incognitoShortcutLabel READ incognitoShortcutLabel NOTIFY shortcutsChanged)
    Q_PROPERTY(QString version READ version CONSTANT)
public:
    explicit App(QObject *parent = nullptr);
    ~App() override;

    bool start(bool preview);       // false if D-Bus registration failed

    Settings *settings() const { return m_settings; }
    bool isOpen() const { return m_open; }
    bool isPreview() const { return m_previewMode; }
    QVariantList tags() const;
    QStringList typeOrder() const;
    QString shortcutLabel() const;
    QString incognitoShortcutLabel() const;
    QString version() const;

    // ---------- for QML ----------
    Q_INVOKABLE QString typeName(const QString &type) const;
    Q_INVOKABLE QString typeIcon(const QString &type) const;
    Q_INVOKABLE QString tagName(const QString &id) const;
    Q_INVOKABLE QString tagColor(const QString &id) const;
    Q_INVOKABLE bool isEditable(const QString &type) const;
    Q_INVOKABLE QString content(const QString &id) const;

    // Enter / click / Space. With "paste on select" off, plain choose copies and Shift pastes.
    Q_INVOKABLE void choose(const QString &id, bool shift, bool ctrl);
    Q_INVOKABLE void activate(const QString &id, const QString &mode);   // paste | copy | action
    Q_INVOKABLE void pasteText(const QString &id, const QString &text);  // paste a variant (colour format, path)
    Q_INVOKABLE void pastePaths(const QString &id);
    Q_INVOKABLE void openItem(const QString &id);
    Q_INVOKABLE void showInFolder(const QString &id);
    Q_INVOKABLE QVariantList colorConversions(const QString &id) const;

    Q_INVOKABLE void togglePin(const QString &id);
    Q_INVOKABLE void setTag(const QString &id, const QString &tag);   // same tag again clears it
    Q_INVOKABLE void clearTag(const QString &id);
    Q_INVOKABLE void setTitle(const QString &id, const QString &title);
    Q_INVOKABLE bool deleteItem(const QString &id, bool force);       // false if protected
    Q_INVOKABLE void updateContent(const QString &id, const QString &text);
    Q_INVOKABLE void clearHistory(bool includeProtected);
    Q_INVOKABLE void configureShortcuts();
    Q_INVOKABLE QString relativeTime(double ms) const;

public Q_SLOTS:
    Q_SCRIPTABLE void toggle();
    Q_SCRIPTABLE void open();
    Q_SCRIPTABLE void close();
    Q_SCRIPTABLE void toggleIncognito();
    Q_SCRIPTABLE void openClearConfirm();
    Q_SCRIPTABLE void openSettings();
    Q_SCRIPTABLE void showPreview(bool on);   // draw the bar without taking the keyboard (screenshots)
    Q_SCRIPTABLE void quit();
    Q_SCRIPTABLE int itemCount() const;
    Q_SCRIPTABLE void pasteItem(int position);   // 0 = most recent; for scripts and key bindings

Q_SIGNALS:
    void openChanged();
    void aboutToOpen();          // QML: reset search, filters and focus
    void clearConfirmRequested();
    void shortcutsChanged();

private:
    void setupShortcuts();
    void setupBar();
    void showBar(bool preview);
    void applyNewSessionPolicy();
    void onSettingChanged(const QString &key);
    void syncTray();
    void pasteLater(const QString &id, const QString &asText, bool hasText);
    QString shellQuote(const QString &s) const;

    Settings *m_settings;
    Store *m_store;
    FilterModel *m_filter;
    Highlighter *m_highlighter;
    LinkPreview *m_links;
    KWinBridge *m_kwin;
    Capture *m_capture;
    Paster *m_paster = nullptr;
    Tray *m_tray = nullptr;
    QQmlApplicationEngine *m_engine = nullptr;
    QPointer<QQuickWindow> m_bar;
    QPointer<QQuickWindow> m_settingsWindow;
    QAction *m_openAction = nullptr;
    QAction *m_incognitoAction = nullptr;
    QTimer m_trimTimer;
    bool m_open = false;
    bool m_previewMode = false;
};
