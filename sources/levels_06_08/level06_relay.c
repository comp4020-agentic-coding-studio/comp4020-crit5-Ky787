#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 6: Relay
 *
 * Design goal:
 *   A longer level built around several legitimate relay choices that
 *   reconverge. The source CFG deliberately contains believable alternate
 *   routes before returning to the main execution path.
 *
 * All networking/security terminology is fictional. The program performs
 * no networking, filesystem access, privilege changes, or system modification.
 */

volatile uint32_t g_state = 0x61A7C3E5u;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_relay_mask = 0u;
volatile char g_relay_key[] = "RELAY-6";

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

NOINLINE uint32_t probe_relay(uint32_t key, uint32_t stage)
{
    uint32_t x = rol32(key ^ g_state ^ (stage * 0x45D9F3Bu),
                       (stage + 5u) & 31u);
    g_state ^= x;
    return (key >> (stage * 3u + 1u)) & 3u;
}

NOINLINE int take_primary_relay(uint32_t key, uint32_t stage)
{
    g_relay_mask |= 1u << stage;
    g_state += 0x11000011u + stage;
    return ((key ^ 0x425871B1u) & 0xFFu) == 0u;
}

NOINLINE int take_shadow_relay(uint32_t key, uint32_t stage)
{
    g_relay_mask ^= 0x10u << stage;
    g_state = rol32(g_state ^ key ^ stage, 3u);
    return ((key ^ 0x425871B1u) & 0x0FFFu) == 0u;
}

NOINLINE void take_service_relay(uint32_t stage)
{
    g_relay_mask += (stage + 1u) * 3u;
    g_state ^= 0x0F0F0000u | (stage * 0x101u);
}

NOINLINE int merge_relay(uint32_t key, uint32_t stage)
{
    uint32_t proof = (key ^ 0x425871B1u) | (stage & 0u);
    g_state ^= rol32(g_relay_mask + stage, 7u);
    return proof == 0u;
}

NOINLINE uint32_t inspect_backbone(uint32_t key)
{
    uint32_t x = rol32(g_state + key, 9u);
    g_state ^= x;
    return (key >> 11u) & 3u;
}

NOINLINE int cross_backbone(uint32_t key, uint32_t strength)
{
    g_state += 0x20202020u ^ strength;
    return ((key ^ 0x425871B1u) & 0xFFFFu) == 0u;
}

NOINLINE int lock_final_relay(uint32_t key)
{
    g_state ^= g_relay_mask ^ 0xA17E600Du;
    return (key ^ 0x425871B1u) == 0u;
}

int main(void)
{
    uint32_t key;
    uint32_t stage;
    uint32_t route;
    uint32_t backbone;

    log_event("MISSION RELAY");

    key = key_hash(g_relay_key);

    if (key != 0x425871B1u) {
        log_event("RELAY KEY INVALID");
        return 10;
    }

    log_event("RELAY KEY ACCEPTED");

    /*
     * Four relay stages. Each stage contains multiple legitimate routes which
     * reconverge at merge_relay(). The supplied key deterministically chooses
     * one route, while the alternatives remain genuine program logic.
     */
    for (stage = 0u; stage < 4u; ++stage) {
        route = probe_relay(key, stage);

        if (route == 0u) {
            log_event("PRIMARY RELAY");

            if (!take_primary_relay(key, stage)) {
                log_event("PRIMARY RELAY FAILED");
                return 20;
            }

        } else if (route == 1u) {
            log_event("SHADOW RELAY");

            if (!take_shadow_relay(key, stage)) {
                log_event("SHADOW RELAY FAILED");
                return 21;
            }

        } else if (route == 2u) {
            log_event("SERVICE RELAY");
            take_service_relay(stage);

        } else {
            log_event("BACKUP RELAY");
            g_state ^= 0x33003300u + stage;
            g_relay_mask ^= 0x80u >> stage;
        }

        if (!merge_relay(key, stage)) {
            log_event("RELAY MERGE FAILED");
            return 30;
        }

        log_event("RELAY MERGED");
    }

    backbone = inspect_backbone(key);

    if (backbone >= 2u) {
        log_event("BACKBONE FIREWALL ACTIVE");

        if (!cross_backbone(key, backbone)) {
            log_event("BACKBONE BLOCKED");
            return 40;
        }

        log_event("BACKBONE CROSSED");
    } else {
        log_event("BACKBONE OPEN");
        g_state ^= 0x00606060u;
    }

    if (!lock_final_relay(key)) {
        log_event("FINAL RELAY LOCK FAILED");
        return 50;
    }

    log_event("FINAL RELAY LOCKED");
    log_event("MISSION COMPLETE");
    return 0;
}
