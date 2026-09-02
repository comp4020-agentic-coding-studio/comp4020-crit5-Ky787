#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 4: Watchdog
 *
 * Level-design goal:
 *   State-dependent route choices under time pressure. A small watchdog counter
 *   advances after each major stage, giving the eventual game a natural
 *   pursuer/timer mechanic without a large switch or flattened CFG.
 *
 * No real anti-debugging or watchdog behaviour occurs.
 */

volatile uint32_t g_state = 0x2468ACE0u;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_watchdog_ticks = 0u;
volatile char g_session_key[] = "TICK-9";

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

NOINLINE uint32_t session_hash(const volatile char *text)
{
    uint32_t h = 2166136261u;
    unsigned i;

    for (i = 0; text[i] != '\0' && i < 12u; ++i) {
        h ^= (uint8_t)text[i];
        h *= 16777619u;
    }

    return h;
}

NOINLINE void arm_watchdog(uint32_t key)
{
    g_watchdog_ticks = 1u;
    g_state ^= rol32(key, 5u);
}

NOINLINE uint32_t choose_route(uint32_t key, uint32_t stage)
{
    uint32_t x = (key >> (stage * 3u)) ^ g_state ^ (stage * 0x1357u);
    return (x ^ (stage * 3u)) & 3u;
}

NOINLINE void watchdog_step(uint32_t stage)
{
    g_watchdog_ticks += 2u + (stage & 1u);
    g_state = rol32(g_state ^ (0x10101010u + stage), 3u);
}

NOINLINE int suppress_alarm(uint32_t key, uint32_t stage)
{
    g_state ^= (key >> (stage + 1u)) | 0x40000000u;
    return ((key ^ 0xA3375116u) & 0x3FFu) == 0u;
}

NOINLINE int cross_checkpoint(uint32_t key, uint32_t stage)
{
    g_state += (stage + 1u) * 0x01020304u;
    return ((key ^ 0xA3375116u) & 0xFFFFu) == 0u;
}

NOINLINE int disarm_watchdog(uint32_t key)
{
    uint32_t proof = key ^ 0xA3375116u;
    g_watchdog_ticks = 0u;
    g_state ^= 0xDEAD700Du;
    return proof == 0u;
}

int main(void)
{
    uint32_t key;
    uint32_t stage;
    uint32_t route;

    log_event("MISSION WATCHDOG");

    key = session_hash(g_session_key);

    if (key != 0xA3375116u) {
        log_event("SESSION KEY INVALID");
        return 10;
    }

    arm_watchdog(key);
    log_event("WATCHDOG ONLINE");

    /*
     * Three state-dependent checkpoints. The loop is short and deliberate;
     * route selection changes as g_state changes.
     */
    for (stage = 0u; stage < 3u; ++stage) {
        route = choose_route(key, stage);

        if (route == 0u) {
            log_event("ROUTE ALPHA");
            g_state ^= 0xAAAA0000u;

        } else if (route == 1u) {
            log_event("ROUTE BETA");

            if (!suppress_alarm(key, stage)) {
                log_event("ALARM TRIGGERED");
                return 20;
            }

            log_event("ALARM SUPPRESSED");

        } else if (route == 2u) {
            log_event("ROUTE GAMMA");
            g_state += 0x30303030u;

        } else {
            log_event("ROUTE SHADOW");
            g_state ^= 0x0F0F0F0Fu;
        }

        if (!cross_checkpoint(key, stage)) {
            log_event("CHECKPOINT FAILED");
            return 30;
        }

        watchdog_step(stage);

        if (g_watchdog_ticks >= 10u) {
            log_event("WATCHDOG CAUGHT SESSION");
            return 40;
        }

        if (g_watchdog_ticks >= 7u)
            log_event("WATCHDOG CLOSE");
        else
            log_event("WATCHDOG TRACKING");
    }

    log_event("FINAL SAFE ZONE");

    if (!disarm_watchdog(key)) {
        log_event("WATCHDOG DISARM FAILED");
        return 50;
    }

    log_event("WATCHDOG OFFLINE");
    log_event("MISSION COMPLETE");
    return 0;
}
