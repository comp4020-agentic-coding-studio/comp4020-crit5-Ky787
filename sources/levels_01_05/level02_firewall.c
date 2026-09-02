#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 2: Firewall
 *
 * Level-design goal:
 *   Nested authentication and permission branches. The player should feel as
 *   though they are climbing through several gates, with tempting side routes.
 *
 * All "security" behaviour is fictional and only mutates dummy variables.
 */

volatile uint32_t g_state = 0x27182818u;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_gate_mask = 0u;
volatile char g_badge[] = "GATE-7";

static uint32_t rol32(uint32_t x, unsigned n)
{
    return (x << n) | (x >> (32u - n));
}

NOINLINE void log_event(const char *text)
{
    uint32_t h = g_event_checksum ^ 0x811C9DC5u;
    unsigned i;

    for (i = 0; text[i] != '\0' && i < 48u; ++i) {
        h ^= (uint8_t)text[i];
        h *= 16777619u;
    }

    g_event_checksum = h;
}

NOINLINE uint32_t badge_hash(const volatile char *text)
{
    uint32_t h = 2166136261u;
    unsigned i;

    for (i = 0; text[i] != '\0' && i < 12u; ++i) {
        h ^= (uint8_t)text[i];
        h *= 16777619u;
    }

    return h;
}

NOINLINE uint32_t inspect_outer_gate(uint32_t badge)
{
    uint32_t x = rol32(badge ^ 0x6D23B1A5u, 3u);
    g_state ^= x;
    return (badge >> 1u) & 3u;
}

NOINLINE int present_credentials(uint32_t badge)
{
    g_state += (badge & 0xFFFFu) ^ 0x4172u;
    return ((badge ^ 0xD10A40AEu) & 0xFFu) == 0u;
}

NOINLINE uint32_t inspect_inner_gate(uint32_t badge)
{
    uint32_t x = (badge >> 7u) ^ rol32(g_state, 9u);
    g_state ^= x & 0x00FFFFFFu;
    return (badge >> 13u) & 3u;
}

NOINLINE int elevate_clearance(uint32_t badge, uint32_t layer)
{
    g_gate_mask |= 1u << (layer & 7u);
    g_state ^= 0xA55A0000u | (layer * 0x101u);
    return ((badge ^ 0xD10A40AEu) & 0x0FFFu) == 0u;
}

NOINLINE int open_service_gate(uint32_t badge)
{
    g_gate_mask ^= (badge >> 8u) & 7u;
    return ((badge ^ 0xD10A40AEu) & 0xFFFFu) == 0u;
}

NOINLINE uint32_t inspect_exit_route(uint32_t badge)
{
    g_state ^= g_gate_mask * 0x10101u;
    return (badge >> 1u) & 3u;
}

NOINLINE int seal_route(uint32_t badge)
{
    g_state = rol32(g_state ^ badge, 5u);
    return (badge ^ 0xD10A40AEu) == 0u;
}

int main(void)
{
    uint32_t badge;
    uint32_t outer;
    uint32_t inner;
    uint32_t route;

    log_event("MISSION FIREWALL");

    if (g_badge[0] == '\0') {
        log_event("BADGE MISSING");
        return 10;
    }

    badge = badge_hash(g_badge);

    /*
     * The constants below are calibrated to the supplied badge. They make the
     * winning trace deterministic while leaving real alternate branches in
     * the program for other hypothetical inputs.
     */
    if (badge != 0xD10A40AEu) {
        log_event("UNKNOWN BADGE");
        return 11;
    }

    log_event("BADGE ACCEPTED");

    outer = inspect_outer_gate(badge);

    if (outer >= 2u) {
        log_event("OUTER FIREWALL CLOSED");

        if (!present_credentials(badge)) {
            log_event("OUTER GATE DENIED");
            return 20;
        }

        log_event("OUTER GATE OPEN");
    } else {
        log_event("OUTER FIREWALL WEAK");
        g_state ^= 0x0000CAFEu;
    }

    inner = inspect_inner_gate(badge);

    if (inner == 0u) {
        log_event("INNER GATE SERVICE ROUTE");

        if (!open_service_gate(badge)) {
            log_event("SERVICE ROUTE SEALED");
            return 30;
        }

        log_event("SERVICE ROUTE OPEN");
    } else {
        log_event("INNER GATE REQUIRES CLEARANCE");

        if (inner >= 2u) {
            log_event("ELEVATED CLEARANCE REQUIRED");

            if (!elevate_clearance(badge, inner)) {
                log_event("CLEARANCE REJECTED");
                return 31;
            }

            log_event("CLEARANCE ELEVATED");
        } else {
            log_event("STANDARD CLEARANCE");
            g_gate_mask |= 1u;
        }
    }

    route = inspect_exit_route(badge);

    if (route == 3u) {
        log_event("EXIT ROUTE A");
        g_state ^= 0x11110000u;
    } else if (route == 2u) {
        log_event("EXIT ROUTE B");
        g_state ^= 0x22220000u;
    } else {
        log_event("MAINTENANCE EXIT");
        g_state ^= 0x33330000u;
    }

    if (!seal_route(badge)) {
        log_event("GATE SEAL FAILED");
        return 40;
    }

    log_event("FIREWALL STACK CLEARED");
    log_event("MISSION COMPLETE");
    return 0;
}
