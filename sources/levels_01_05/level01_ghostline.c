#include <stdint.h>

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#elif defined(__clang__) || defined(__GNUC__)
#define NOINLINE __attribute__((noinline))
#else
#define NOINLINE
#endif

/*
 * Binary Ninja - Level 1: Ghostline
 *
 * Tutorial mission. Mostly forward-moving control flow with a few legitimate
 * alternate branches and three obvious security-themed encounters.
 *
 * No real networking, security bypassing, malware activity, filesystem access,
 * or system modification occurs. All themed functions only mutate dummy state.
 */

volatile uint32_t g_state = 0x31415926u;
volatile uint32_t g_event_checksum = 0u;
volatile uint32_t g_watchdog = 0u;
volatile char g_supplied_token[] = "N1NJ4";

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

NOINLINE uint32_t read_access_token(const volatile char *text)
{
    uint32_t h = 2166136261u;
    unsigned i;

    if (text == 0)
        return 0u;

    for (i = 0; text[i] != '\0' && i < 8u; ++i) {
        h ^= (uint8_t)text[i];
        h *= 16777619u;
    }

    return h;
}

NOINLINE uint32_t scan_network(uint32_t token)
{
    uint32_t x = rol32(token ^ 0xA17C9E31u, 5u);
    g_state += x * 3u;
    return x ^ (g_state >> 3u) ^ 0x10203040u;
}

NOINLINE uint32_t inspect_firewall(uint32_t node)
{
    return (node ^ (g_state >> 7u)) & 3u;
}

NOINLINE int bypass_firewall(uint32_t token, uint32_t strength)
{
    uint32_t gate = (token ^ 0xE5929FFCu) & 0xFFu;
    g_state ^= (strength + 1u) * 0x01010101u;
    return gate < 0x40u;
}

NOINLINE uint32_t scan_antivirus(uint32_t token, uint32_t node)
{
    uint32_t signature = ((token >> 9u) ^ node ^ g_state) & 3u;
    return signature == 3u ? 2u : signature;
}

NOINLINE int evade_scanner(uint32_t token, uint32_t signature)
{
    g_state += (signature + 1u) * 0x1111u;
    return ((token ^ 0xE5929FFCu) & 0x0Fu) == 0u;
}

NOINLINE void start_watchdog(uint32_t token)
{
    g_watchdog = ((token >> 8u) ^ (g_state >> 5u)) & 0x0Fu;
    g_state ^= 0x55AA10EFu;
}

NOINLINE int decrypt_channel(uint32_t token)
{
    uint32_t key_fragment = (token ^ 0xE5929FFCu) & 0x03FFu;
    g_state = rol32(g_state ^ token, 7u);
    return key_fragment == 0u;
}

NOINLINE int transfer_archive(uint32_t token)
{
    uint32_t x = token ^ g_state;
    unsigned i;

    for (i = 0; i < 6u; ++i) {
        x ^= rol32(x + 0x9E3779B9u + i, (i + 3u) & 31u);
        g_state ^= x;
    }

    return ((token ^ 0xE5929FFCu) & 0xFFFFu) == 0u;
}

NOINLINE void clean_session(void)
{
    g_watchdog = 0u;
    g_state ^= 0xDEADC0DEu;
}

int main(void)
{
    uint32_t token;
    uint32_t node;
    uint32_t firewall;
    uint32_t scanner;

    log_event("OPERATION GHOSTLINE");

    if (g_supplied_token[0] == '\0') {
        log_event("ACCESS TOKEN REQUIRED");
        return 10;
    }

    token = read_access_token(g_supplied_token);
    log_event("ACCESS TOKEN PARSED");

    node = scan_network(token);

    if ((node & 3u) == 3u) {
        log_event("PRIMARY RELAY FOUND");
    } else {
        log_event("ROUTING THROUGH DECOY RELAY");
        node ^= 0x00C0FFEEu;
    }

    firewall = inspect_firewall(node);

    if (firewall >= 2u) {
        log_event("FIREWALL ACTIVE");

        if (!bypass_firewall(token, firewall)) {
            log_event("FIREWALL LOCKOUT");
            return 20;
        }

        log_event("FIREWALL BYPASSED");
    } else {
        log_event("FIREWALL RULE WEAK");
    }

    scanner = scan_antivirus(token, node);

    if (scanner == 2u) {
        log_event("ANTIVIRUS SCAN ACTIVE");

        if (!evade_scanner(token, scanner)) {
            log_event("SESSION QUARANTINED");
            return 30;
        }

        log_event("SCANNER EVADED");
    } else if (scanner == 1u) {
        log_event("ANTIVIRUS DORMANT");
    } else {
        log_event("NO SCANNER SIGNATURE");
    }

    start_watchdog(token);
    log_event("WATCHDOG ARMED");

    if ((g_watchdog & 1u) != 0u)
        log_event("WATCHDOG RUNNING HOT");
    else
        log_event("WATCHDOG STABLE");

    if (!decrypt_channel(token)) {
        log_event("CHANNEL DECRYPTION FAILED");
        return 40;
    }

    log_event("CHANNEL DECRYPTED");

    if (!transfer_archive(token)) {
        log_event("TRANSFER REJECTED");
        return 50;
    }

    log_event("ARCHIVE TRANSFER COMPLETE");

    if (token != 0xE5929FFCu) {
        log_event("FINAL TOKEN CHECK FAILED");
        return 60;
    }

    clean_session();
    log_event("SESSION CLEAN - OPERATION COMPLETE");
    return 0;
}
