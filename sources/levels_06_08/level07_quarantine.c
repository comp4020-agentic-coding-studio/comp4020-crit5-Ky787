#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 7: Quarantine
 *
 * Design goal:
 *   A predominantly vertical level. The source contains two controlled
 *   containment loops separated by a firewall checkpoint. Each containment
 *   layer has legitimate alternate scanner/escape behaviour.
 *
 * All security terminology is fictional and all functions only mutate
 * dummy state.
 */

volatile uint32_t g_state = 0x7A11D00Du;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_pressure = 0u;
volatile uint32_t g_floor_mask = 0u;
volatile char g_quarantine_key[] = "QUAR-7";

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

NOINLINE uint32_t scan_floor(uint32_t key, uint32_t floor)
{
    uint32_t x = rol32(key ^ g_state ^ (floor * 0x9E3779B9u),
                       (floor + 4u) & 31u);
    g_pressure = (g_pressure + (x & 7u) + 1u) & 0x1Fu;
    g_state ^= x;
    return (key >> (floor * 2u + 2u)) & 3u;
}

NOINLINE int hide_on_floor(uint32_t key, uint32_t floor)
{
    g_floor_mask |= 1u << floor;
    g_state += (floor + 1u) * 0x00111111u;
    return ((key ^ 0x8F20E234u) & 0xFFu) == 0u;
}

NOINLINE void vent_pressure(uint32_t floor)
{
    uint32_t amount = 2u + (floor & 3u);

    if (g_pressure > amount)
        g_pressure -= amount;
    else
        g_pressure = 0u;

    g_state ^= 0x55000000u | floor;
}

NOINLINE int cross_floor(uint32_t key, uint32_t floor)
{
    g_state = rol32(g_state + key + floor, 5u);
    return ((key ^ 0x8F20E234u) & 0x0FFFu) == 0u;
}

NOINLINE uint32_t inspect_containment_gate(uint32_t key)
{
    g_state ^= rol32(key ^ g_floor_mask, 11u);
    return (key >> 9u) & 3u;
}

NOINLINE int open_containment_gate(uint32_t key, uint32_t strength)
{
    g_state += 0x71000000u | strength;
    return ((key ^ 0x8F20E234u) & 0xFFFFu) == 0u;
}

NOINLINE int evade_quarantine_core(uint32_t key)
{
    uint32_t proof = key ^ 0x8F20E234u;
    g_pressure = 0u;
    g_state ^= g_floor_mask ^ 0x0BAD7007u;
    return proof == 0u;
}

int main(void)
{
    uint32_t key;
    uint32_t floor;
    uint32_t signature;
    uint32_t gate;

    log_event("MISSION QUARANTINE");

    key = key_hash(g_quarantine_key);

    if (key != 0x8F20E234u) {
        log_event("QUARANTINE KEY INVALID");
        return 10;
    }

    log_event("LOWER CONTAINMENT ENTERED");

    /*
     * First ascent: three containment floors.
     */
    for (floor = 0u; floor < 3u; ++floor) {
        signature = scan_floor(key, floor);

        if (signature == 3u) {
            log_event("SCANNER LOCK");

            if (!hide_on_floor(key, floor)) {
                log_event("LOWER FLOOR EXPOSED");
                return 20;
            }

            log_event("SIGNATURE HIDDEN");

        } else if (signature == 2u) {
            log_event("SCANNER HIGH");
            vent_pressure(floor);

        } else if (signature == 1u) {
            log_event("SCANNER LOW");
            g_state ^= 0x10101010u + floor;

        } else {
            log_event("SCANNER BLIND");
            g_floor_mask ^= 1u << floor;
        }

        if (!cross_floor(key, floor)) {
            log_event("LOWER FLOOR BLOCKED");
            return 21;
        }
    }

    log_event("CONTAINMENT FIREWALL");

    gate = inspect_containment_gate(key);

    if (gate >= 2u) {
        log_event("FIREWALL SEALED");

        if (!open_containment_gate(key, gate)) {
            log_event("QUARANTINE SEALED");
            return 30;
        }

        log_event("FIREWALL OPEN");
    } else {
        log_event("FIREWALL MAINTENANCE GAP");
        g_state ^= 0x00C0FFEEu;
    }

    log_event("UPPER CONTAINMENT ENTERED");

    /*
     * Second ascent: three more floors with different state because the first
     * loop and firewall have already mutated g_state/g_pressure.
     */
    for (floor = 3u; floor < 6u; ++floor) {
        signature = scan_floor(key, floor);

        if (signature == 0u) {
            log_event("UPPER BLIND SPOT");
            g_state ^= 0x22220000u | floor;

        } else if (signature == 1u) {
            log_event("UPPER SCANNER LOW");
            vent_pressure(floor);

        } else {
            log_event("UPPER SCANNER ACTIVE");

            if (!hide_on_floor(key, floor)) {
                log_event("UPPER FLOOR EXPOSED");
                return 40;
            }

            log_event("UPPER SIGNATURE HIDDEN");
        }

        if (!cross_floor(key, floor)) {
            log_event("UPPER FLOOR BLOCKED");
            return 41;
        }

        if (g_pressure > 28u) {
            log_event("QUARANTINE PRESSURE CRITICAL");
            return 42;
        }
    }

    log_event("QUARANTINE CORE REACHED");

    if (!evade_quarantine_core(key)) {
        log_event("CORE ESCAPE FAILED");
        return 50;
    }

    log_event("CONTAINMENT ESCAPED");
    log_event("MISSION COMPLETE");
    return 0;
}
