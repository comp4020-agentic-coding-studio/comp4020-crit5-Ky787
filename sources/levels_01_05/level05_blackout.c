#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 5: Blackout
 *
 * Final mission. Combines nested gates, scanner pressure, a short repeated
 * transfer phase, watchdog state, and multiple legitimate route choices.
 *
 * Intended candidate for the normal house obfuscation plus string encryption.
 *
 * All operations are fictional dummy-state transformations.
 */

volatile uint32_t g_state = 0xC001D00Du;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_watchdog = 0u;
volatile uint32_t g_transfer_state = 0u;
volatile char g_blackout_key[] = "BLACK-5";

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

NOINLINE uint32_t probe_perimeter(uint32_t key)
{
    uint32_t x = rol32(key ^ g_state ^ 0x70F00D11u, 7u);
    g_state ^= x;
    return (key >> 14u) & 3u;
}

NOINLINE int breach_perimeter(uint32_t key, uint32_t strength)
{
    g_state += 0x11110000u | strength;
    return ((key ^ 0x9CEED15Au) & 0xFFu) == 0u;
}

NOINLINE uint32_t scan_core(uint32_t key)
{
    uint32_t x = rol32(g_state + key, 9u);
    g_state ^= x;
    return (key >> 3u) & 3u;
}

NOINLINE int cloak_session(uint32_t key)
{
    g_state = rol32(g_state ^ 0xAA55CC33u, 5u);
    return ((key ^ 0x9CEED15Au) & 0x0FFFu) == 0u;
}

NOINLINE void arm_final_watchdog(uint32_t key)
{
    g_watchdog = 2u + ((key >> 4u) & 1u);
    g_state ^= 0x51515151u;
}

NOINLINE uint32_t select_channel(uint32_t key, uint32_t phase)
{
    return ((key >> (phase * 4u)) ^ g_state ^ phase) & 3u;
}

NOINLINE int transfer_fragment(uint32_t key, uint32_t phase, uint32_t channel)
{
    uint32_t x = key ^ g_state ^ (phase * 0x9E37u) ^ (channel * 0x101u);
    g_transfer_state ^= rol32(x, (phase + 5u) & 31u);
    g_state += x;
    return ((key ^ 0x9CEED15Au) & 0xFFFFu) == 0u;
}

NOINLINE void watchdog_advance(uint32_t phase)
{
    g_watchdog += 2u + (phase & 1u);
    g_state ^= 0x01010101u * (phase + 1u);
}

NOINLINE int blackout_core(uint32_t key)
{
    uint32_t proof = (key ^ 0x9CEED15Au) | g_watchdog;
    g_state ^= g_transfer_state ^ 0xB10C0FFu;
    return (proof & 0xFFFFFF00u) == 0u;
}

NOINLINE void clean_exit(void)
{
    g_watchdog = 0u;
    g_transfer_state = 0u;
    g_state ^= 0xFACEB00Cu;
}

int main(void)
{
    uint32_t key;
    uint32_t perimeter;
    uint32_t scanner;
    uint32_t phase;
    uint32_t channel;

    log_event("OPERATION BLACKOUT");

    key = key_hash(g_blackout_key);

    if (key != 0x9CEED15Au) {
        log_event("BLACKOUT KEY INVALID");
        return 10;
    }

    perimeter = probe_perimeter(key);

    if (perimeter >= 2u) {
        log_event("PERIMETER FIREWALL ACTIVE");

        if (!breach_perimeter(key, perimeter)) {
            log_event("PERIMETER LOCKOUT");
            return 20;
        }

        log_event("PERIMETER BREACHED");
    } else {
        log_event("PERIMETER SIDE CHANNEL");
        g_state ^= 0x000BADC0u;
    }

    scanner = scan_core(key);

    if (scanner == 3u) {
        log_event("CORE SCANNER LOCK");

        if (!cloak_session(key)) {
            log_event("CORE QUARANTINE");
            return 30;
        }

        log_event("SESSION CLOAKED");
    } else if (scanner == 2u) {
        log_event("CORE SCANNER HIGH");
        g_state ^= 0x22222222u;
    } else {
        log_event("CORE SCANNER SEARCHING");
        g_state ^= 0x11111111u;
    }

    arm_final_watchdog(key);
    log_event("FINAL WATCHDOG ARMED");

    /*
     * Three transfer phases. Each phase has a legitimate channel choice and
     * advances the watchdog, combining route ambiguity with time pressure.
     */
    for (phase = 0u; phase < 3u; ++phase) {
        channel = select_channel(key, phase);

        if (channel == 0u) {
            log_event("CHANNEL ZERO");
        } else if (channel == 1u) {
            log_event("CHANNEL ONE");
        } else if (channel == 2u) {
            log_event("CHANNEL TWO");
        } else {
            log_event("SHADOW CHANNEL");
        }

        if (!transfer_fragment(key, phase, channel)) {
            log_event("TRANSFER FRAGMENT LOST");
            return 40;
        }

        log_event("TRANSFER FRAGMENT COMPLETE");

        watchdog_advance(phase);

        if (g_watchdog >= 11u) {
            log_event("WATCHDOG INTERCEPT");
            return 50;
        }

        if (g_watchdog >= 8u)
            log_event("WATCHDOG CRITICAL");
        else
            log_event("WATCHDOG APPROACHING");
    }

    log_event("CORE READY FOR BLACKOUT");

    if (!blackout_core(key)) {
        log_event("BLACKOUT FAILED");
        return 60;
    }

    log_event("CORE OFFLINE");
    clean_exit();
    log_event("TRACE ERASED");
    log_event("OPERATION COMPLETE");
    return 0;
}
