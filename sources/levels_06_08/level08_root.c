#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 8: Root
 *
 * Design goal:
 *   Longest mission and true finale. It combines a vertical access climb,
 *   branching route selection, scanner pressure, a watchdog chase, and a
 *   multi-stage objective sequence. Intended for split3 and optional STR.
 *
 * All operations are fictional dummy-state transformations.
 */

volatile uint32_t g_state = 0x8E3779B9u;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_watchdog = 0u;
volatile uint32_t g_access_mask = 0u;
volatile uint32_t g_root_progress = 0u;
volatile char g_root_key[] = "ROOT-8";

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

NOINLINE uint32_t key_hash(const volatile char *text)
{
    uint32_t h = 2166136261u;
    unsigned i;

    for (i = 0; text[i] != '\0' && i < 12u; ++i) {
        h ^= (uint8_t)text[i];
        h *= 16777619u;
    }

    return h;
}

NOINLINE uint32_t inspect_access_layer(uint32_t key, uint32_t layer)
{
    uint32_t x = rol32(key ^ g_state ^ (layer * 0x27D4EB2Du),
                       (layer + 6u) & 31u);
    g_state ^= x;
    return (key >> (layer * 3u + 1u)) & 3u;
}

NOINLINE int open_access_layer(uint32_t key, uint32_t layer)
{
    g_access_mask |= 1u << layer;
    g_state += 0x10010010u + layer;
    return ((key ^ 0x79C50AC0u) & 0xFFu) == 0u;
}

NOINLINE int take_service_path(uint32_t key, uint32_t layer)
{
    g_access_mask ^= 0x20u << layer;
    g_state = rol32(g_state ^ key ^ layer, 4u);
    return ((key ^ 0x79C50AC0u) & 0x0FFFu) == 0u;
}

NOINLINE uint32_t scan_root_channel(uint32_t key, uint32_t phase)
{
    uint32_t x = rol32(g_state + key + (phase * 0x13579u),
                       (phase + 5u) & 31u);
    g_state ^= x;
    return (key >> (phase * 2u + 4u)) & 3u;
}

NOINLINE int cloak_root_session(uint32_t key, uint32_t phase)
{
    g_state ^= 0xAA550000u | (phase * 0x101u);
    return ((key ^ 0x79C50AC0u) & 0xFFFFu) == 0u;
}

NOINLINE void arm_root_watchdog(uint32_t key)
{
    g_watchdog = 1u + ((key >> 5u) & 1u);
    g_state ^= rol32(key, 7u);
}

NOINLINE void watchdog_step(uint32_t phase)
{
    g_watchdog += 2u + (phase & 1u);
    g_state = rol32(g_state ^ (0x51510000u + phase), 3u);
}

NOINLINE uint32_t choose_objective_route(uint32_t key, uint32_t phase)
{
    uint32_t x = (key >> (phase * 4u)) ^ g_state ^ g_access_mask;
    return x & 3u;
}

NOINLINE int commit_root_stage(uint32_t key, uint32_t phase, uint32_t route)
{
    uint32_t x = key ^ g_state ^ (phase * 0x9E37u) ^ (route * 0x101u);
    g_root_progress ^= rol32(x, (phase + 3u) & 31u);
    g_state += x;
    return ((key ^ 0x79C50AC0u) & 0xFFFFu) == 0u;
}

NOINLINE int verify_root_state(uint32_t key)
{
    uint32_t proof = key ^ 0x79C50AC0u;
    g_state ^= g_root_progress ^ g_access_mask;
    return proof == 0u;
}

NOINLINE void clean_root_session(void)
{
    g_watchdog = 0u;
    g_access_mask = 0u;
    g_root_progress = 0u;
    g_state ^= 0xF00D8008u;
}

int main(void)
{
    uint32_t key;
    uint32_t layer;
    uint32_t phase;
    uint32_t route;
    uint32_t scanner;

    log_event("MISSION ROOT");

    key = key_hash(g_root_key);

    if (key != 0x79C50AC0u) {
        log_event("ROOT KEY INVALID");
        return 10;
    }

    log_event("ROOT ACCESS CLIMB");

    /*
     * Four access layers: intended to become the opening vertical section.
     */
    for (layer = 0u; layer < 4u; ++layer) {
        route = inspect_access_layer(key, layer);

        if (route >= 2u) {
            log_event("ACCESS FIREWALL");

            if (!open_access_layer(key, layer)) {
                log_event("ACCESS LAYER DENIED");
                return 20;
            }

            log_event("ACCESS LAYER OPEN");

        } else if (route == 1u) {
            log_event("SERVICE ACCESS");

            if (!take_service_path(key, layer)) {
                log_event("SERVICE PATH FAILED");
                return 21;
            }

            log_event("SERVICE PATH CROSSED");

        } else {
            log_event("SHADOW ACCESS");
            g_state ^= 0x0A0A0000u | layer;
            g_access_mask ^= 1u << layer;
        }
    }

    log_event("ROOT CHANNEL ENTERED");

    /*
     * Scanner section before the chase.
     */
    for (phase = 0u; phase < 3u; ++phase) {
        scanner = scan_root_channel(key, phase);

        if (scanner >= 2u) {
            log_event("ROOT SCANNER LOCK");

            if (!cloak_root_session(key, phase)) {
                log_event("ROOT SESSION EXPOSED");
                return 30;
            }

            log_event("ROOT SESSION CLOAKED");

        } else if (scanner == 1u) {
            log_event("ROOT SCANNER SWEEP");
            g_state ^= 0x22222222u + phase;

        } else {
            log_event("ROOT SCANNER GAP");
            g_state ^= 0x11111111u + phase;
        }
    }

    arm_root_watchdog(key);
    log_event("ROOT WATCHDOG ACTIVE");

    /*
     * Four objective phases. Each phase chooses a legitimate route, commits a
     * stage of the operation, then advances the watchdog.
     */
    for (phase = 0u; phase < 4u; ++phase) {
        route = choose_objective_route(key, phase);

        if (route == 0u) {
            log_event("OBJECTIVE ROUTE ALPHA");
        } else if (route == 1u) {
            log_event("OBJECTIVE ROUTE BETA");
        } else if (route == 2u) {
            log_event("OBJECTIVE ROUTE GAMMA");
        } else {
            log_event("OBJECTIVE ROUTE SHADOW");
        }

        if (!commit_root_stage(key, phase, route)) {
            log_event("ROOT STAGE FAILED");
            return 40;
        }

        log_event("ROOT STAGE COMPLETE");
        watchdog_step(phase);

        if (g_watchdog >= 14u) {
            log_event("ROOT WATCHDOG INTERCEPT");
            return 50;
        }

        if (g_watchdog >= 10u)
            log_event("ROOT WATCHDOG CRITICAL");
        else if (g_watchdog >= 6u)
            log_event("ROOT WATCHDOG CLOSE");
        else
            log_event("ROOT WATCHDOG TRACKING");
    }

    log_event("ROOT OBJECTIVE REACHED");

    if (!verify_root_state(key)) {
        log_event("ROOT STATE INVALID");
        return 60;
    }

    log_event("ROOT CONTROL ACQUIRED");
    clean_root_session();
    log_event("ROOT SESSION CLEAN");
    log_event("MISSION COMPLETE");
    return 0;
}
