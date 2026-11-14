# Карта музыки «Тот, кто остался» — вариации тем Николая

**Три трека-основы (ждут вердикта по раскладке):**

| Трек | Данные | Характер | Куда (черновик) |
|------|--------|----------|-----------------|
| **o2 pt1-2** | 4:40, G минор, 144 BPM | волны нарастания, главный мотив | ТЕМА ГЕРОЯ: З1–З7, З11 (лицо игры, детство, ветви, светлые финалы) |
| **Only Space** | 2:25, A минор, 89 BPM | звонкий, разреженный, «космос» | ЯКОРЬ И БЕЗДНА: З9 (якорь-шов), З12 (Ф-01/Ф-05, пустые миры) |
| **Big Nothing** | 3:48, G минор, 81 BPM | ровный тяжёлый драйв без разрешения | ДРЕЙФ И НИЧТО: З8 (хоррор), З10 (тупики), стингер З4 |

Метод: MusicGen melody-conditioning — нейросеть берёт мелодическую линию исходника и одевает её в новую аранжировку. Мотив и настроение сохраняются, меняется «одежда» под сцену.

Источники мелодии (куски из o2, если не указан другой трек):
- **intro** (0–30 с) — тихое интро: для подводных, тупиковых, финально-тихих зон.
- **theme** (30–60 с) — основная тема: лирические и «лицевые» зоны.
- **climax** (140–170 с) — кульминация: якорь, хоррор, стингеры, напряжённые зоны.

Источники мелодии (куски из исходника):
- **intro** (0–30 с) — тихое интро: для подводных, тупиковых, финально-тихих зон.
- **theme** (30–60 с) — основная тема: лирические и «лицевые» зоны.
- **climax** (140–170 с) — кульминация: якорь, хоррор, стингеры, напряжённые зоны.

## З1. «Заводь-ночь 2061» — ЛИЦО ИГРЫ
**Куда:** Т-00 «Пролог», Я-01 «Рыбаки», главное меню, экран «Тот, кто остался».
**Характер:** тревожная торжественность, туман, комета, рыбаки без тел.
**Источник:** theme.
**Промпт:** Cinematic dark folk ballad, solemn and mysterious: deep warm sub-bass drone, distant low church bell, soft acoustic guitar arpeggios, airy wordless choir pads, sparse piano, slow heartbeat pulse. Misty Siberian night over a river lagoon, comet overhead. G minor, 72 bpm, haunting, spacious reverb, melancholic but hopeful.

## З2. «Под водой / Корень»
**Куда:** Т-01 «Чёрная заводь» (нырок), Т-02 «Четыре минуты» (утопление, счёт до 252), шов Я-02.
**Характер:** тёплое солнце детства, рваное утоплением; глухой подводный гул, далёкий детский голос.
**Источник:** intro.
**Промпт:** Underwater ambient lullaby, warm muffled sunlight through dark water: soft filtered guitar harmonics, deep hollow low rumble, distant children voice-like woodwind, gentle music-box notes, slow breathing rhythm. Submerged childhood memory turning cold. G minor, very slow, dreamy, eerie but tender.

## З3. «Двор 90-х» (ствол 1996–2007)
**Куда:** Т-03…Т-09 (Водяной, Рельсовая война, Коробка, Бакенщик, Лёд, Везунчик), Т-10 «Рассвет».
**Характер:** чистая лирика 90-х: двор, река, велосипед, щенок Бублик. Без тревоги.
**Источник:** theme.
**Промпт:** Warm nostalgic 90s Russian courtyard folk: bright acoustic guitar strumming, soft mandolin, light accordion, sunny riverbank atmosphere, playful whistle-like flute, gentle steady rhythm. Childhood summer by a Siberian river, carefree and kind. G major lift over G minor base, mid-tempo, heartwarming.

## З4. «Стингер смерти» (откат)
**Куда:** каждая смерть с откатом (шок-экран: надгробие «1989–1996», лента-откат), 69 смертей; текст shock_first.
**Характер:** резкий, холодный, обрыв на полуслове. 6–8 секунд.
**Источник:** climax (рваная).
**Промпт:** Harsh cinematic stinger, sudden icy shock: dissonant piano cluster, metallic scrape, deep sub drop, cold reversed choir swell, abrupt silence cut. Quantum death and rollback. G minor, no rhythm, 8 seconds, sharp and cold.

## З5. «Шахта и металл» (В1, В2, завод В7)
**Куда:** В1 «Лампа» (шахта «Глубокая», 04:12), В2 «Протокол» (лаборатория Лунёва), В2-08 «Двенадцать минут», В1-08 «Через год», завод В7.
**Характер:** пульс, металл, метроном; напряжение без распевов.
**Источник:** climax.
**Промпт:** Tense industrial thriller underscore: pulsing deep bass ostinato like machinery, metallic percussion hits, low cello drone, ticking clock motif at 04:12, sparse cold piano. Dark mine tunnel and laboratory hum. G minor, 96 bpm, relentless, suspenseful, mechanical.

## З6. «Север» (В3 «Партия»)
**Куда:** В3 «Партия» — гольцы Шории, Якутия, Булгуннях, зимовье, Сардаана.
**Характер:** ветровая звенящая пустота, широта, мороз.
**Источник:** theme.
**Промпт:** Vast windswept northern ambient folk: airy flute over wide strings, icy bells, resonant jaw harp echoes, wind howl texture, sparse cold guitar. Endless tundra and mountain tundra under aurora. G minor, slow, spacious, frozen and free.

## З7. «Море и Плой» (В5 «Тёпллая вода»)
**Куда:** В5 «Тёплая вода» — Ко Тао, Бангкок в воде, В5-01 «Курьер» (Плой на носу лодки), В5-04 «Вода по пояс», В5-13 «Не ходи на заводь».
**Характер:** мягкая тропическая лирика с одной фальшнотой угрозы (кубомедуза).
**Источник:** theme.
**Промпт:** Warm tropical romantic ballad with hidden danger: soft nylon guitar, gentle ukulele pluck, warm bass, light marimba waves, breathy flute, one subtle detuned string hint of unseen threat. Full-moon tropical sea, love and jellyfish. G minor leaning warm, mid-tempo, tender, bittersweet.

## З8. «Хоррор-Хор» (В4, В6, высокий Дрейф)
**Куда:** В4 «Барабан» (казино Шадрина, рефрижератор), В6 «Хор» (скит, «чужие в моём тоне»), ⊣К-06 «Щегловск», В6-09.
**Характер:** расстроенные инструменты, свой мотив чужими голосами.
**Источник:** climax.
**Промпт:** Unsettling horror ambient: detuned music box playing a familiar tune wrong, ghost choir singing in wrong key, reversed guitar, whispers in static, deep drone shifting microtones. The choir is inside your head, copies of yourself. G minor bent out of tune, very slow, terrifying, claustrophobic.

## З9. «Якорь-шов» (Я-02, Я-03)
**Куда:** Я-02 «Двести пятьдесят два» (старик в полдне 1996-го = герой из 2061-го), Я-03 «Тальник» (выбор финала).
**Характер:** ночь и полдень одновременно; петля замыкается; кульминация всей игры.
**Источник:** climax.
**Промпт:** Grand emotional orchestral-folk climax: full warm strings swelling over solo acoustic guitar stating the main theme, distant choir joining, bell tolls, oceanic sub swell, sunlit water and night stars merged. The time loop closes, the boy is saved by himself. G minor to G major lift, 72 bpm building, cathartic, epic, tender.

## З10. «Тупики» (⊣К-01…⊣К-12)
**Куда:** все тупиковые финалы; текст обрывается на «Конец свя…».
**Характер:** три градуса, но одна база: виноватая (К-01, К-10), ледяная (К-03, К-11), отчаянно-тихая (К-07, К-08, К-12). Обрыв в конце.
**Источник:** intro.
**Промпт (базовый, тихая):** Broken desolate ambient elegy: faded music box with dying battery, empty room reverb, distant train, cold wind through cracked window, a choir that never resolves, sudden mute ending mid-phrase. Nobody came to the lagoon. G minor, extremely sparse, exhausted, mourning.
**Вариант ледяной:** + icy high strings, metal cold sheen.
**Вариант виноватой:** + heavy slow piano chords like confession.

## З11. «Финалы светлые» (Ф-02, Ф-03, Ф-04)
**Куда:** Ф-02 «Одна жизнь» («Пошли домой»), Ф-03 «Река» (жертвенный, памятник), Ф-04 «Сверим часы» (1996-й, пиво с отцом).
**Характер:** тёплая домашняя; Ф-03 — светлый трагизм; Ф-04 — ностальгия.
**Источник:** theme.
**Промпт:** Radiant grateful folk finale: warm acoustic guitar and piano stating the theme in full light, soft strings embracing, gentle choir humming, morning sun over the river, a smile through tears. Letting the gift fade, going home. G major resolution, mid-tempo, peaceful, luminous, grateful.

## З12. «Финалы вечные» (Ф-01, Ф-05, Ф-06)
**Куда:** Ф-01 «Тот, кто остался» (бессмертие в одиночестве), Ф-05 «Утро после» (открыть Хор всем), Ф-06 «Сапёр» (вечно спасать).
**Характер:** тот же светлый мотив, но без разрешения — уходит в бесконечность.
**Источник:** theme → intro-хвост.
**Промпт:** Endless drifting finale, light that never resolves: solo guitar theme over infinite airy pads, far bell fading, slow tidal swell, choir thinning into stars, unresolved final chord left open. Immortality in empty worlds, quiet dawn after everything. G minor suspended, very slow, vast, lonely yet calm.

## З13. DLC «Объяснение» — «Ночь без откатов»
**Куда:** вся ночь DLC: квартал, карта, Витька (газ, 02:45), Ника (ИВЛ, 03:00), Даня (котлован, 03:40), Гоша, шлюз.
**Характер:** ночная операционная спешка без мистики; часы тикают; тёплая горечь — Хор подсказал, кого спасать.
**Источник:** theme.
**Промпт:** Nocturnal urban urgency with warm heart: ticking clock pulse, low suspense bass, muted night city textures, fleeting piano runs, soft hopeful strings underneath, no mysticism, real night streets. Race against time to save three lives. G minor, 108 bpm, urgent, focused, human.

---
## РЕАЛИЗАЦИЯ (14.11.2026, факт)

- **Метод:** Suno Cover V6 через шлюз sunoapi.org (ключ в `Z/secrets/sunoapi_key.txt`). Референс — 30-сек фрагмент темы, опубликованный на сайте (`game/music/ref_*.mp3`), параметры: `audioWeight 0.75–0.8`, `styleWeight 0.6–0.8`, instrumental.
- MusicGen melody (локально и через HF Space) отбракован: мотив не переносит, выдаёт шум (spectral flatness 0.136 против 0.008 у оригинала, хрома-связь 0.25). EQ-ремиксы (librosa/ffmpeg) — как запасной «тёплый» вариант, не используются.
- **Треки:** `game/music/suno_z1_v1/v2 … suno_z16.mp3` — 16 зон, каждая ветка жизни имеет свой трек (В2 «Протокол» z14, В6 «Хор» z15, В7 «Обычная жизнь» z16 — отдельные от соседей).
- **Движок:** `game/music.js` (QQM): карта «префикс сцены → файл», кроссфейд 2,5 с между ветками, луп, стингер смерти (z4, one-shot поверх приглушённого фона), мьют синк с кнопкой «звук», фоллбэк на меню-тему при 404.
- **Хуки в engine.js:** `enter()` → QQM.scene(id); `show("#title")` → QQM.screen; `die()` → QQM.stinger(); `soundBtn()` → QQM.setMuted.
- **Правила циклов:** фон ветки играет непрерывно через все её сцены, рвётся только смертью; после отката возвращается. Треки-лупы Suno имеют fade-концы — при лупе «дыхание» громкости, при вердикте подрезать ffmpeg'ом.
- **Плеер вердиктов:** `/music.html`. Деплой: `build_stage_qq.sh` (music.js добавлен в cache-bust).

