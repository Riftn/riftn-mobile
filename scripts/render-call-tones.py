#!/usr/bin/env python3
"""Render the two call sounds.

assets/sounds/call-ring.wav: what an incoming call plays until it is answered,
declined or gives up. A soft bell arpeggio (E5 G#5 B5, then E6 held), then a
rest, looped by the player.

assets/sounds/call-ringback.wav: what the caller hears while the other phone
rings. One low two-note bell, then a longer rest.

The web plays the same files from public/sounds (copied there by hand).
Usage: python3 scripts/render-call-tones.py
"""
import math, os, struct, wave

RATE = 22050
PARTIALS = [(1, 1.0), (2, 0.22), (3, 0.06)]
ATTACK = 0.008


def render(notes, length, gain):
    samples = [0.0] * int(RATE * length)
    for freq, at, dur in notes:
        start = int(at * RATE)
        for multiple, level in PARTIALS:
            for i in range(int(dur * RATE)):
                if start + i >= len(samples):
                    break
                t = i / RATE
                if t < ATTACK:
                    env = t / ATTACK
                else:
                    env = math.exp(-4.2 * (t - ATTACK) / dur)
                # A short fade at the very end so a note never clicks off.
                tail = min(1.0, (dur - t) / 0.02)
                samples[start + i] += level * env * tail * math.sin(2 * math.pi * freq * multiple * t)
    peak = max(abs(s) for s in samples) or 1.0
    return [s / peak * gain for s in samples]


def write(name, samples):
    out = os.path.join(os.path.dirname(__file__), "..", "assets", "sounds", name)
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))
    print(out, len(samples), "samples")


E5, GS5, B5, E6 = 659.25, 830.61, 987.77, 1318.51
ring = []
for burst in (0.0, 1.05):
    ring += [(E5, burst, 0.42), (GS5, burst + 0.12, 0.42), (B5, burst + 0.24, 0.45), (E6, burst + 0.36, 0.62)]
write("call-ring.wav", render(ring, 3.4, 0.8))

A4, CS5 = 440.0, 554.37
write("call-ringback.wav", render([(A4, 0.0, 0.9), (CS5, 0.18, 1.1)], 3.6, 0.45))
