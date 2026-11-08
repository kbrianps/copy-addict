// Sends the paste keys to the focused window through KWin's fake input protocol.
// KWin only grants it to programs whose .desktop file lists org_kde_kwin_fake_input
// in X-KDE-Wayland-Interfaces (see data/org.kbrianps.copy-addict.desktop).
#pragma once

#include <QObject>

struct wl_display;
struct wl_event_queue;
struct wl_registry;
struct org_kde_kwin_fake_input;

class Paster : public QObject
{
    Q_OBJECT
public:
    explicit Paster(QObject *parent = nullptr);
    ~Paster() override;

    bool isAvailable() const { return m_fakeInput != nullptr; }
    // Ctrl+V, or Ctrl+Shift+V for terminals.
    bool sendPaste(bool terminal);

    void onGlobal(wl_registry *registry, uint32_t name, const char *interface, uint32_t version);

private:
    wl_display *m_display = nullptr;
    wl_event_queue *m_queue = nullptr;
    wl_display *m_wrapper = nullptr;
    wl_registry *m_registry = nullptr;
    org_kde_kwin_fake_input *m_fakeInput = nullptr;
    uint32_t m_version = 0;
};
