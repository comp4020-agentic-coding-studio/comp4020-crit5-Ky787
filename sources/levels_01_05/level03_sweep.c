#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 3: Sweep
 *
 * Level-design goal:
 *   Introduce one small, controlled loop. The player repeatedly traverses a
 *   scanner zone, but each pass has a different semantic state and one of
 *   several legitimate side branches.
 *
 * No real antivirus or process scanning takes place.
 */

volatile uint32_t g_state = 0x13579BDFu;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_scan_heat = 0u;
volatile char g_scan_key[] = "SWEEP-3";

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

NOINLINE uint32_t scanner_pass(uint32_t key, uint32_t zone)
{
    uint32_t x = rol32(key ^ (zone * 0x9E3779B9u) ^ g_state, (zone + 3u) & 31u);
    g_scan_heat = (g_scan_heat + (x & 7u) + zone) & 0x1Fu;
    g_state ^= x;
    return (x >> 4u) & 3u;
}

NOINLINE int hide_signature(uint32_t key, uint32_t zone)
{
    g_state += (zone + 1u) * 0x111111u;
    return ((key ^ 0xC0D9549Bu) & 0xFFu) == 0u;
}

NOINLINE void cool_scanner(uint32_t zone)
{
    g_scan_heat = (g_scan_heat > zone) ? (g_scan_heat - zone) : 0u;
    g_state ^= 0x00AA5500u | zone;
}

NOINLINE int cross_monitor(uint32_t key, uint32_t zone)
{
    uint32_t token = (key >> (zone + 1u)) ^ g_state;
    g_state = rol32(g_state + token, 3u);
    return ((key ^ 0xC0D9549Bu) & 0x03FFu) == 0u;
}

NOINLINE int leave_scan_ring(uint32_t key)
{
    g_scan_heat ^= key & 7u;
    return (key ^ 0xC0D9549Bu) == 0u;
}

int main(void)
{
    uint32_t key;
    uint32_t zone;
    uint32_t signature;

    log_event("MISSION SWEEP");

    if (g_scan_key[0] == '\0')
        return 10;

    key = key_hash(g_scan_key);

    if (key != 0xC0D9549Bu) {
        log_event("SCAN KEY INVALID");
        return 11;
    }

    log_event("SCAN RING ENTERED");

    /*
     * Four passes through one real loop. In the eventual game this is intended
     * to become a recognisable repeated scanner area rather than a huge cycle.
     */
    for (zone = 0u; zone < 4u; ++zone) {
        signature = scanner_pass(key, zone);

        if (signature == 3u) {
            log_event("SCANNER LOCKED ON");

            if (!hide_signature(key, zone)) {
                log_event("SIGNATURE EXPOSED");
                return 20;
            }

            log_event("SIGNATURE HIDDEN");

        } else if (signature == 2u) {
            log_event("SCANNER SWEEP HIGH");
            cool_scanner(zone + 1u);

        } else if (signature == 1u) {
            log_event("SCANNER SWEEP LOW");
            g_state ^= 0x01010101u * (zone + 1u);

        } else {
            log_event("SCANNER BLIND SPOT");
            g_scan_heat ^= zone;
        }

        if (!cross_monitor(key, zone)) {
            log_event("MONITOR BLOCKED");
            return 30;
        }

        if (g_scan_heat > 26u) {
            log_event("SCAN HEAT CRITICAL");
            return 31;
        }
    }

    log_event("SCAN RING EXIT");

    if (!leave_scan_ring(key)) {
        log_event("EXIT SIGNATURE FAILED");
        return 40;
    }

    log_event("SCANNER EVADED");
    log_event("MISSION COMPLETE");
    return 0;
}
