# Brag Plan: pidash

The plan behind `.github/readme/demo.mp4`, written with the brag skill's planning rubric (the skill's bundled slim
workflow, since Hyperframes isn't installed here: the video is composed by `clip.mjs` from the captures `capture.mjs`
makes of the real page, and mixed with ffmpeg).

## What is this app?

A live dashboard and fan controller for one Raspberry Pi 5, served by the Pi to the owner's tailnet, that pins every
reading to the part it comes from on an exploded 3D model of the board.

## The angle

An instrument film. No metaphor, no set: the real page, full-bleed and big enough to read, doing the three things a
visitor would install it for, with one benefit line per scene in the project's own words.

## Hook (first 2-3 seconds)

The home page with something wrong: "1 problem, 2 to check" beside the exploded board, which turns under the pointer.
The line "Know what's wrong, and where." lands as the board settles.

## Key moments (the middle)

- The pointer rests on "Under-voltage happened since boot": the PMIC callout, its leader and the chip on the board
  light amber. Nothing else moves.
- A press on Performance: "Switching to Performance..." and the readout climbing 0, 3,225, 3,952, 4,398 rpm at the
  demo's real pace.
- Update... asks first; Update now; the apt log streams in and ends with "Succeeded, exit code 0" and the reboot
  notice.

## Outro / punchline

The banner's own layout: the name, the tagline, the board, and `sudo ./install.sh` typed in, then install.sh's last
line.

## User flow worth showing

entry: open the page, read the verdict -> key action: press a profile, or Update -> result: the fan follows within a
second, or the log ends in Succeeded. The centrepiece scenes are these flows on the real page.

## Tone

- Preset: polished
- Creative direction: a crisp instrument film: the real page full-bleed, one benefit line per scene, the board turning
  once, the UI big enough to read
- Interpretation: four scenes, long holds, soft dips between them, no decorative motion; the page's own changes are
  the motion

## Format: landscape, 1920x1080, 24 fps
## Duration: 22 s

## Visual identity (from the project)

- Background: #07110d (the field), #0b1712 (the mask)
- Accent: #d9b35d (ENIG gold, controls only); health LEDs #45d983 / #ffb93e / #ff5f55
- Text: #edf0e8, dim #b3bfb6, faint #8a9a90
- Display font: Archivo 700 at width 116
- Body font: Archivo 400
- Strongest visual element: the exploded Pi 5 with silkscreen callouts routed at 45 degrees

## Share copy (draft)

Introducing pidash: mission control for your Raspberry Pi 5. Live readings pinned to the board, fan curves you draw,
updates without SSH, all over your tailnet.

## Audio direction

- Role: warm bed, sparse professional accents
- Music: brag's bundled `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean)
- Music treatment: from 0 s at 0.30, 0.6 s fade-in, 1.5 s fade-out at the end
- Music cue guidance: preset `vol-12.music-cues.md` read; the fan press and the Succeeded line sit near strong cues
  where the storyboard allows; sequential text holds to the reading floor
- Audio-reactive treatment: none (the UI is the motion)
- SFX posture: sparse; a soft drop under each benefit line, a click under each press, key ticks under the typed
  install line, one soft impact under the name at the outro
- Restraint rule: nothing above the music; no whooshes, no risers, no stacked hits

## Storyboard

### Scene 1 - Hook, the board - 7.0 s
The home page (`?demo`, 1 problem, 2 to check), full-bleed. 0.0-1.2 s still; 1.2-3.7 s the pointer drags the board a
quarter turn; 0.5 s "HEALTH" kicker and the line "Know what's wrong, and where." rise bottom-left; 4.1-4.8 s the
pointer glides to the under-voltage reason, the PMIC lights; hold to 7.0 s.
Sequential/interaction: yes, a drag then a hover, drawn from the capture's pointer events
Audio intent: the bed starts quietly; the line lands on a soft drop
Transition mood: soft dip -> Scene 2

### Scene 2 - The fan - 6.0 s
`?demo&healthy`, full-bleed, a 1.00-1.06 push-in on the fan card. 0.5-1.4 s the pointer glides to Performance;
1.4 s press (click SFX); "Switching to Performance..." then the readout climbs to 4,398 rpm by 5.5 s. Line: "A
quieter or cooler Pi, without a reboot." from 0.6 s.
Sequential/interaction: yes, a press, then the numbers changing at the demo's pace
Audio intent: the click is the only accent
Transition mood: soft dip -> Scene 3

### Scene 3 - The update - 6.0 s
The System card (`?demo&healthy`), full-bleed, the log playing at 1.5x. 0.0 s the confirm dialog is up; 0.3 s press
Update now (click SFX); the log streams; "Succeeded, exit code 0" and the reboot notice by 5.0 s; hold. Line: "Updates,
reboots and restarts, from your phone, not SSH." from 0.6 s.
Sequential/interaction: yes, a press, then the log lines arriving
Audio intent: the bed carries it; the Succeeded badge gets no hit (restraint)
Transition mood: soft dip -> Scene 4

### Scene 4 - Outro - 3.0 s
The banner's layout on the field: the board right, the name and the tagline left (rise 0.0-0.6 s, soft impact), then
`$ sudo ./install.sh` typed key by key (0.9-2.0 s, key ticks) and install.sh's own line "pidash is running
(systemctl status pidash)." Hold to the end; the music fades.
Sequential/interaction: yes, typed text
Audio intent: settle and close
Transition mood: fade to the field

**Music mood for this video:** steady and clean
**Audio summary:** one quiet bed, three soft accents, key ticks, a fade.
