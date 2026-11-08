#include "paster.h"

#include "wayland-fake-input-client-protocol.h"

#include <QGuiApplication>
#include <wayland-client.h>

#include <linux/input-event-codes.h>

static const wl_registry_listener registryListener = {
    [](void *data, wl_registry *registry, uint32_t name, const char *interface, uint32_t version) {
        static_cast<Paster *>(data)->onGlobal(registry, name, interface, version);
    },
    [](void *, wl_registry *, uint32_t) {},
};

Paster::Paster(QObject *parent)
    : QObject(parent)
{
    auto *wayland = qGuiApp->nativeInterface<QNativeInterface::QWaylandApplication>();
    if (!wayland) {
        qWarning("copy-addict: not a Wayland session, paste keys are disabled");
        return;
    }
    m_display = wayland->display();
    // Our own queue, so the roundtrip below does not dispatch Qt's events.
    m_queue = wl_display_create_queue(m_display);
    m_wrapper = static_cast<wl_display *>(wl_proxy_create_wrapper(m_display));
    wl_proxy_set_queue(reinterpret_cast<wl_proxy *>(m_wrapper), m_queue);
    m_registry = wl_display_get_registry(m_wrapper);
    wl_registry_add_listener(m_registry, &registryListener, this);
    wl_display_roundtrip_queue(m_display, m_queue);
    if (!m_fakeInput) {
        qWarning("copy-addict: KWin did not offer fake input, paste keys are disabled");
        return;
    }
    org_kde_kwin_fake_input_authenticate(m_fakeInput, "copy-addict", "Paste the item chosen in the clipboard history");
    wl_display_flush(m_display);
}

Paster::~Paster()
{
    if (m_fakeInput) {
        if (m_version >= ORG_KDE_KWIN_FAKE_INPUT_DESTROY_SINCE_VERSION)
            org_kde_kwin_fake_input_destroy(m_fakeInput);
        else
            wl_proxy_destroy(reinterpret_cast<wl_proxy *>(m_fakeInput));
    }
    if (m_registry)
        wl_registry_destroy(m_registry);
    if (m_wrapper)
        wl_proxy_wrapper_destroy(m_wrapper);
    if (m_queue)
        wl_event_queue_destroy(m_queue);
}

void Paster::onGlobal(wl_registry *registry, uint32_t name, const char *interface, uint32_t version)
{
    if (qstrcmp(interface, org_kde_kwin_fake_input_interface.name) != 0)
        return;
    if (version < ORG_KDE_KWIN_FAKE_INPUT_KEYBOARD_KEY_SINCE_VERSION)
        return;
    m_version = std::min<uint32_t>(version, 5);
    m_fakeInput = static_cast<org_kde_kwin_fake_input *>(wl_registry_bind(registry, name, &org_kde_kwin_fake_input_interface, m_version));
}

bool Paster::sendPaste(bool terminal)
{
    if (!m_fakeInput)
        return false;
    auto key = [this](uint32_t code, bool down) {
        org_kde_kwin_fake_input_keyboard_key(m_fakeInput, code, down ? WL_KEYBOARD_KEY_STATE_PRESSED : WL_KEYBOARD_KEY_STATE_RELEASED);
    };
    key(KEY_LEFTCTRL, true);
    if (terminal)
        key(KEY_LEFTSHIFT, true);
    key(KEY_V, true);
    key(KEY_V, false);
    if (terminal)
        key(KEY_LEFTSHIFT, false);
    key(KEY_LEFTCTRL, false);
    wl_display_flush(m_display);
    return true;
}
