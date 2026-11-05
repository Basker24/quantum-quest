# Визуальная библия «Тот, кто остался»

> Источник истины для картинок. Канон: `01_canon.md` п. 24 («семейный альбом во времени», героя не показываем).
> Данные персонажей и каст сцен живут в `tools/build_cast.py`. После правки запусти `python3 tools/build_cast.py`:
> он пересоберёт `docs/generated/characters.csv`, `docs/generated/scene_cast.csv` и раздел «Карточки» ниже.
> Стиль (манера рисовки и носители эпох) задаётся в `tools/artstyle.py`. Генерация: `tools/gen_images.py`.

## 1. Общие правила

1. **Первое лицо.** Всё снято (нарисовано) глазами Андрея. Героя в кадре нет никогда: ни лица, ни отражения, ни фигуры со спины. Можно показывать только **его руки** и то, что на них:
   - **шрам на правой ладони** от основания большого пальца к запястью. Он есть с 28.07.1996 на всех путях. До Т-03 это свежий розовый порез со швами, потом бледная полоса;
   - часы «Штурманские» со звёздочкой, только если сцена гарантирует флаг (I3: `F_Т01 = ЧАСЫ` или Я-02 и дальше). Сборщик сам их не добавляет;
   - тельняшка и брезентовая штормовка в 2061 году, только там, где их называет текст сцены.
2. **Сцены, где исходный промпт показывает героя**, исправлены в `scene_cast.csv` (FIX в `build_cast.py`): Я-02 — лицо мальчика отвёрнуто; Ф-03 — эмаль на памятнике выцвела до неузнаваемости; Ф-04 — старик в тельняшке превращён во взгляд от первого лица (видна только его рука в мокром полосатом рукаве). Сами сцены не тронуты, вопрос вынесен автору.
3. **Не фотореализм, но фото.** Каждая картинка — **рисованная** (манера рисовки, §2), но выглядит как **снимок своей эпохи** (носитель, §3): рамка, зерно, глянец, цифровой шум, стерильность.
4. **Без текста.** Никаких подписей и водяных знаков. Надписи допускаются, только если они нужны сюжету и уже есть в промпте сцены: «JELLYFISH» (В5-02), «NAM UN DIVING» (В5-07), «Second Chance» и логотип «Орфея» (В2.2-04, В2.2-06), трафарет на гермодвери (В1-11). Подпись под фото выводит движок, а не картинка.
5. **Реализм места.** Кузбасс: Кемерово, Рудничный, Томь, терриконы, хрущёвки, АБК, копры. Таиланд в В5. Шахты и аварии вымышленные (канон п. 21).
6. **Без реальных людей и брендов.** Все лица вымышленные. Логотипов нет (футболка Сомчая — «faded red football shirt without logos»). «Нокии», «девятка», «Нива» — названия моделей допустимы как предметы, без логотипов.
7. **Сходство персонажей держится тремя слоями.**
   - Ядро (`core`): черты, которые не меняются с возрастом. Оно попадает в эталонный портрет.
   - Эталон: портрет `game/img/ref/<char>_<age>.png`. Сцены, где есть этот персонаж, генерируются через endpoint правки и получают эталоны как референсы.
   - Короткий облик в тексте промпта сцены (`In frame: …`).
8. **Смерти** (`✝…`) своих картинок не имеют: после смерти движок показывает надгробие. Картинки есть только у сцен с `photo_prompt` (104 шт.).

## 2. Манера рисовки (STYLE_ANCHOR)

Одна на всю игру. В CSV вместо неё стоит плейсхолдер `[STYLE_ANCHOR]`, а `gen_images.py --style N` подставляет вариант N. Пока автор не выбрал, `DEFAULT_STYLE = None` и скрипт берёт 1 с предупреждением.

| N | имя | фраза (EN) | зачем |
|---|---|---|---|
| 1 | painterly | soft digital painting like key art of a narrative video game, visible brushstrokes, simplified shapes, expressive warm-and-cold light | «кадры нарративной игры», самый безопасный вариант |
| 2 | ink-watercolor | ink line drawing with loose watercolour washes, visible paper texture, restrained palette, lines left unfinished at the edges | лёгкость и недосказанность, хорошо ложится на «память» |
| 3 | gouache-soviet | gouache and oil painting with bold visible brushstrokes, in the spirit of Soviet 1970s-80s children's book illustration, flat expressive forms | рифма с детством героя, советская книжка |
| 4 | cel-shaded | graphic cel-shaded illustration, clean confident outlines, limited palette of five tones, hard-edged shadow shapes | самый «игровой», лучше всех держит сходство |
| 5 | charcoal | pencil and charcoal drawing, smudged tones, visible hatching, rough paper grain | мрачно, документально, хорошо для шахты и смертей |

**Проба стилей:** `python3 tools/gen_images.py --style-test`. Строит одну сцену (Т-01, дети на реке, 1996) в пяти манерах, **в цвете, без носителя эпохи** (без рамки и зерна), чтобы была видна сама манера. Файлы: `game/img/style-test/<n>-<имя>.jpg`. Автор выбирает номер, шоураннер вписывает его в `DEFAULT_STYLE` в `tools/artstyle.py`.

## 3. Носитель эпохи (ERA_MEDIUM)

Ключи совпадают с `photo_eras` в `scenes/_config.json`. Каждый начинается словами «illustrated photograph, painted to look like…»: картинка нарисована, но читается как снимок своего времени.

| эпоха | годы | фраза (EN) |
|---|---|---|
| bw | 1990-е (и фото деда 1981) | illustrated photograph, painted to look like an authentic 1990s black-and-white amateur snapshot from a Soviet film camera: grain, slight blur, white paper border |
| color | 2000-е | illustrated photograph, painted to look like a 2000s colour print from a photo lab: warm faded colours, flash, slight vignette, date-stamp feel |
| digital | 2010-е | illustrated photograph, painted to look like an early 2010s cheap digital point-and-shoot shot: noise, oversaturated colours, harsh flash |
| phone | 2020–2040-е | illustrated photograph, painted to look like a 2020s-2040s smartphone photo: natural light, slightly compressed, candid |
| future | 2050–2061 | illustrated photograph, painted to look like a 2050s-2060s image: ultra-clean, unnaturally sharp and calm, muted palette, eerie perfection |

**Общий хвост (COMMON):** first-person point of view, the narrator is never visible except his own hands, Kemerovo / Kuzbass, Siberia, Russia, no captions, no watermark, no brand logos, no recognizable real people.

**Сборка промпта сцены:** `[сцена из photo_prompt] + In frame: [короткие облики персонажей и рук героя] + Drawing style: [STYLE_ANCHOR] + Medium: [ERA_MEDIUM] + COMMON`.

**Эталонный портрет:** `[облик в возрасте] + Permanent features: [ядро] + Drawing style + Medium (эпоха, в которой персонаж в этом возрасте чаще всего в кадре) + REF_COMMON` (поясной портрет, нейтральный светло-серый фон, мягкий естественный свет). Размер 1024x1536. Эталоны служебные: в публикацию игры не идут.

## 4. Предметы-сквозняки

| предмет | где | описание (EN) |
|---|---|---|
| Коряга-рука | Т-00, Т-01, Т-06, Я-01 | a white bleached snag sticking out of black still water, its branches spread like the fingers of a hand |
| Чёрная заводь | Т-00, Т-01, Т-06, Я-01, Ф-01 | a perfectly round pond of black tea-coloured still water on a stony Tom river bank, flat slate stones, willow bushes |
| Панамка с вишнями | Т-01, Я-02 | a white cotton child's panama hat printed with small red cherries, soft brim |
| Часы «Штурманские» | Т-02б, Я-02, В2.2-00, Ф-02 | an old Soviet men's wristwatch on a steel bracelet, black dial with a small red star, scratched glass, hands stopped at 04:12 |
| Шрам героя | везде, где видны руки | a long pale scar across the right palm from the base of the thumb to the wrist (fresh pink with stitches in 1996) |
| Камертон | В2-04, В6-06, В7-11 | a small old steel tuning fork engraved «ДК шахтёров. Хор "Рудничный"» (надпись только при крупном плане) |
| Лампа ламповой | В1-01, В1-13, ⊣К-02 | a Soviet miner's cap lamp: round headlamp on a cable, heavy battery box, numbered tin tag |
| Тельняшка | Т-02б, Я-02, Ф-04, 2061 | a faded blue-and-white striped sailor's undershirt, wet and clinging |
| Брезентовая штормовка | Я-03, В2.1-09, В5-13, В6-07, В7-12 | an old faded canvas storm jacket, khaki bleached almost white at the seams, a patch on the elbow |
| Тетрадь Хора | В2.1-01, В2.1-07, В2.1-08, ⊣К-08 | a thick school notebook in green oilcloth covers, ruled by hand into columns: number, date, time, place, how, what was heard |
| Конверт «Коле» | Т-05, В2.2-02 | an old yellowed envelope sealed with red sealing wax, handwritten «Коле» |
| Комета Галлея | Т-00, Я-01, 2061 | a bright comet with a long pale tail low over the dry riverbed |
| Сухое русло 2061 | Т-00, Я-01, В2.2-07, В6-13 | the completely dry stone bed of a wide Siberian river, white dust, old rusty cars on the stones |
| «Второй шанс» | В2.2-04, В6-09, В1-12 | glossy advertising of a calm smiling silver-haired man in a good coat (не Шадрин и не реальный человек) |

## 5. Карточки персонажей

Возраст в `scene_cast.csv` — это возраст **эталона**. Близкие возрасты сведены к одному (например, `nika:22` покрывает 22–25 лет), иначе эталонов было бы вдвое больше. Сцены, где персонаж зависит от флага, перечислены в §6.

<!-- cards:begin -->
### `nika` — Ника (1989 г. р., главный)
- Из текста: «лицо серьёзное, как у завуча», панамка с вишнями (Т-01); брекеты, Стругацкие (Т-06); короткая стрижка, Витькина куртка (В1-05, В2-05); седая, коротко стриженная, очки на цепочке (В1-12).
- (додумано) серо-зелёные глаза, прямые тёмные брови, родинка над левым краем верхней губы, каштановые волосы.
- **Ядро сходства:** oval face with a narrow pointed chin, serious level gaze like a strict head teacher, straight dark eyebrows, grey-green eyes, a small mole above the left corner of the upper lip, chestnut hair, slim.
- В кадрах: В1-05, В1-06, В1-12, В2-05, Т-01, Т-06, Я-02.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 7 | 1996 | bw | 7-year-old girl, chestnut chin-length bob under a white child's panama hat printed with cherries, simple cotton sundress, scraped knees |
| 13 | 2002 | color | 13-year-old girl, chestnut hair in a low ponytail, metal braces visible when she smiles, oversized t-shirt, a paperback book in hand |
| 22 | 2011–2014 | digital | young woman of 22-25, chestnut pixie cut, an oversized men's jacket over her shoulders or a white lab coat, no make-up |
| 56 | 2045 | phone | woman of 56, short-cropped grey hair, reading glasses on a thin chain, white doctor's coat, tired lines around the eyes |

### `vitka` — Витька (1988 г. р., главный)
- Из текста: «рыжий в крапинку», орёт громче всех (Т-01); краснеют уши (Т-06); бритый на проводах (Т-09); шахтёр (В1); поседел, белая рубаха поверх свитера (В6-08).
- (додумано) светло-голубые глаза, курносый нос, широкая щербатая улыбка, оттопыренные уши, коренастый.
- **Ядро сходства:** round freckled face, snub nose, light blue eyes, wide grin with a small gap between the front teeth, ears that stick out and go red, ginger hair, stocky build.
- В кадрах: В1-05, В1-06, В1-09, В6-08, Т-01, Т-06, Т-09.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 8 | 1996 | bw | 8-year-old boy, shaggy ginger hair, dense freckles, skinny, shorts and a stretched t-shirt |
| 14 | 2002 | color | 14-year-old boy, ginger hair grown out, freckles, squinting, cheap cigarette, sports jacket |
| 18 | 2006 | color | 18-year-old conscript, freshly shaved head with ginger stubble, red flushed face, freckles, white shirt |
| 23 | 2011–2014 | digital | man of 23-26, short ginger hair, freckles, stocky miner's build, track jacket or a cheap black suit |
| 33 | 2021 | phone | miner of 33, short ginger hair under a dirty helmet, freckles under coal dust, heavy jaw, ginger stubble |
| 43 | 2031 | phone | man of 43, hair and short beard gone completely grey with a trace of ginger, freckles, sober calm face, white shirt over a sweater |

### `father` — Отец, Николай Тихонович (1962 г. р., главный)
- Из текста: ГРОЗ на «Глубокой», рабочая куртка (В6-03); «весь седой» в 57 (В6-07); седой ёжик, инсульт (В1-10); старик у заводи «лицом похож на папу» (Т-03).
- (додумано) длинное худое лицо, тяжёлые надбровья, глубоко посаженные серые глаза, нос с давним переломом, усы до 2000-х.
- **Ядро сходства:** long lean face, heavy brow, deep-set grey eyes, a straight nose with an old break, thin lips, coal dust in the creases of the skin, big knotted miner's hands, wiry build.
- В кадрах: В1-10, В2.2-02, В6-03, В6-07, Ф-04.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 34 | 1996 | bw | miner of 34, short dark hair, dark moustache, tired face, work jacket |
| 45 | 2007 | digital | miner of 45, dark hair greying at the temples, clean-shaven, worn work jacket |
| 59 | 2019–2023 | phone | retired miner of 57-61, completely grey crew cut, grey stubble, deep lines, flannel shirt |
| 65 | 2027 | phone | old man of 65, grey crew cut, one side of the face slack after a stroke, hospital gown |

### `mother` — Мама, Валентина (1966 г. р., главный)
- Из текста: серые глаза («серые, мамины», Ф-03); флотатор ЦОФ, волосы пахнут углём; маленькая, в чёрном платке (В5-09); платок в цветочек, крошечная старушка (В5-13).
- (додумано) круглое мягкое лицо, ямочка на подбородке, шатенка с химической завивкой в 90-е.
- **Ядро сходства:** small and short, soft round face, a dimple in the chin, grey eyes, light-brown hair.
- В кадрах: В5-09, В5-13, В6-03.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 41 | 2007 | digital | woman of 41, light-brown hair under a headscarf, light jacket, small and tired |
| 54 | 2020 | phone | woman of 54, small, black mourning headscarf, medical mask, grey eyes |
| 95 | 2061 | future | tiny very old woman of 95, white hair under a flowered headscarf, soft wrinkled round face, grey eyes |

### `sonka` — Сонька (1998 г. р., главный)
- Из текста: фиолетовые пряди, плеер (В6-05); студентка-медик; глаза серые, мамины (Ф-03); седая, в мамином платке в цветочек (В6-13).
- (додумано) мамино круглое лицо, вздёрнутая верхняя губа, веснушки нет.
- **Ядро сходства:** round face like her mother's, grey eyes, slightly upturned upper lip, light-brown hair, quick sharp look.
- В кадрах: В5-09, В6-05, В6-13, В7-02, Ф-03.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 13 | 2010–2012 | digital | girl of 12-14, light-brown hair with dyed purple streaks, earphones, hoodie |
| 22 | 2020 | phone | young woman of 22, medical student, hair tied back, medical mask, wet angry grey eyes |
| 63 | 2061 | future | woman of 63, grey hair, her mother's flowered headscarf, grey eyes, warm smile lines |

### `lunev` — Вадим Петрович Лунёв (1956 г. р., главный)
- Из текста: «молодой и худой, с портфелем» (Т-05); всё время трёт глаза, серый костюм (Т-02б); поседел до белого (В2-07); маленький, как подросток, очки на шнурке (В2.1-07).
- (додумано) узкое лицо, высокий лоб, светлые близорукие глаза, очки в тонкой оправе всю жизнь.
- **Ядро сходства:** narrow face, high forehead, pale short-sighted eyes, thin wire-rimmed glasses, thin build, habit of rubbing his eyes.
- В кадрах: В2-07, В2.1-01, В2.1-07, Т-05.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 25 | 1981 | bw | thin young man of 25, dark side-parted hair, wire glasses, cheap suit, holding a briefcase |
| 60 | 2016–2017 | digital | man of 60, hair gone completely white, wire glasses, tired eyes, good dark coat |
| 85 | 2041 | phone | very old shrunken man of 85, wispy white hair, glasses hanging on a cord, thin as a teenager |

### `grandpa` — Дед, Тихон Савельевич (1930 г. р., главный)
- Из текста: «в очках и шляпе, похожий на папу, только старше» (Т-05); регент хора «Рудничный» с камертоном (В7-11).
- (додумано) отцовское длинное лицо, тяжёлые надбровья, очки в роговой оправе.
- **Ядро сходства:** long lean face like his son's, heavy brow, deep-set eyes behind horn-rimmed glasses, straight nose.
- В кадрах: В7-11, Т-05.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 51 | 1981 | bw | man of 51, horn-rimmed glasses, a soft brimmed hat, plain jacket, looks like a miner |

### `shadrin` — Шадрин (1948 г. р., главный)
- Из текста: «вежливый мужик под семьдесят в хорошем пальто», сухая тёплая рука; кожаный блокнот, золотая ручка (В2-07, В2.1-00).
- (додумано) аккуратно зачёсанные назад серебряные волосы, гладко выбрит, бледно-голубые глаза, тонкая улыбка.
- **Ядро сходства:** neat silver hair combed back, clean-shaven, pale blue eyes, thin polite smile, upright posture.
- В кадрах: В2.1-00.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 68 | 2016 | phone | man of 68, expensive dark wool coat, white shirt, leather notebook and a gold pen |

### `ploy` — Плой (1986 г. р., главный)
- Из текста: тайка из Нонтхабури, «стрижена почти налысо», смеётся глазами; белый открытый шлем, футболка дайв-школы (В5-03).
- (додумано) широкие скулы, тёмно-карие глаза, родинка на шее слева, жилистая.
- **Ядро сходства:** Thai woman, very short almost shaved black hair, broad cheekbones, dark brown laughing eyes, a small mole on the left side of the neck, wiry athletic build.
- В кадрах: В5-03, В5-04, В5-05, В5-10.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 24 | 2010–2012 | digital | Thai woman of 24-26, almost shaved head, dive school t-shirt, tanned |
| 36 | 2022 | phone | Thai woman of 36, very short black hair, apron, laughing |

### `dasha` — Даша Веснина (2037 г. р., главный)
- Из текста: серьёзная, наушники, рисует круги один в другом (В2.2-05); позже короткая стрижка, тетрадь в клеёнке.
- (додумано) бледное худое лицо, тёмные круги под глазами (почти не спит), прямые тёмные волосы до плеч.
- **Ядро сходства:** pale thin face, dark rings under the eyes, very straight serious stare, straight dark hair.
- В кадрах: В2.2-05.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 12 | 2049 | phone | girl of 12, shoulder-length straight dark hair, big headphones, school uniform |

### `gleb` — Глеб Ростоцкий (1990 г. р., главный)
- Из текста: «худой и острый, как циркуль», бледный (В2-06).
- (додумано) чёрные волосы, впалые щёки, светло-серые глаза.
- **Ядро сходства:** very thin, sharp angular features, hollow cheeks, pale skin, light grey eyes, black hair.
- В кадрах: В2-06.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 24 | 2014 | digital | young man of 24, messy black hair, hoodie, nervous intense smile |

### `anna_markovna` — Анна Марковна (1957 г. р., главный)
- Из текста: «лет пятьдесят, очки висят на шнурке», белый халат, подстаканник (В6-01).
- (додумано) полная, короткая тёмная стрижка с проседью, строгий рот, добрые глаза.
- **Ядро сходства:** plump, short dark hair with grey streaks, strict mouth, kind brown eyes, glasses on a cord.
- В кадрах: В6-01.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 50 | 2007 | digital | psychiatrist of 50, white coat, glasses on a cord |

### `serafim` — Отец Серафим (1941 г. р., главный)
- Из текста: «маленький, сухой, с бородой до пояса», ходит быстро; бывший бас хора (В6-06).
- (додумано) возраст ~75, светлые выцветшие глаза, нос картошкой.
- **Ядро сходства:** small and wiry, waist-long grey beard, faded light eyes, bulbous nose, weathered skin.
- В кадрах: В6-06.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 75 | 2016 | digital | old monk of about 75, patched black cassock, waist-long grey beard |

### `tanya` — Таня-ламповщица (1987 г. р., главный)
- Из текста: «двадцать два, чёлка выкрашена в баклажан» (В1-01).
- (додумано) круглое лицо, ямочки, карие глаза.
- **Ядро сходства:** round face, dimples, brown eyes, hair with a dyed aubergine-purple fringe.
- В кадрах: В1-01.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 22 | 2009 | digital | young woman of 22, aubergine-dyed fringe, blue work smock |

### `palych` — Палыч (1959 г. р., эпизод)
- Из текста: седой командир отделения ВГСЧ, «голос как из бочки» (В1-04, В1-05).
- (додумано) широкое лицо, перебитый нос.
- **Ядро сходства:** broad face, broken nose, grey hair cut short, barrel chest.
- В кадрах: В1-05.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 52 | 2011 | digital | mine rescue commander of 52, grey hair, rescue squad t-shirt |

### `seryoga` — Серёга (1988 г. р., эпизод)
- Из текста: напарник, балагур, муж Ники в В1 (В1-05, В1-06).
- (додумано) коренастый, тёмный ёжик, щёки.
- **Ядро сходства:** stocky, dark buzz cut, round cheeks, cheerful storyteller face.
- В кадрах: В1-05.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 23 | 2011 | digital | young miner of 23, dark buzz cut, stocky |

### `mikhalych` — Михалыч (1951 г. р., эпизод)
- Из текста: «сорок лет под землёй, руки похожи на корни» (В1-01).
- (додумано) седые усы, сутулый.
- **Ядро сходства:** stooped old miner, grey moustache, hands like roots.
- В кадрах: В1-02.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 58 | 2009 | digital | old miner of 58 in a helmet and dirty work clothes, grey moustache |

### `polina` — Полина, оператор «Девятки» (1993 г. р., эпизод)
- Из текста: «девчонка из Подольска с секундомером на шее» (В2.1-01).
- (додумано) светлый хвост, веснушки нет, деловитая.
- **Ядро сходства:** young woman, blond ponytail, businesslike face.
- В кадрах: В2.1-01.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 25 | 2017 | phone | operator of 25, blond ponytail, stopwatch on a cord, lab coat |

### `den` — Дэн из Северска (1989 г. р., эпизод)
- Из текста: «рассказывает и сам ржёт громче всех» (В2-01).
- (додумано) длинный, вихрастый, спортивный костюм.
- **Ядро сходства:** lanky, tousled light hair, big laugh.
- В кадрах: В2-01.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 18 | 2007 | digital | lanky student of 18 in a tracksuit, tousled hair |

### `alla_borisovna` — Алла Борисовна (1963 г. р., эпизод)
- Из текста: «рыжее каре и золотые кольца на каждом пальце» (В5-01).
- (додумано) яркая помада.
- **Ядро сходства:** dyed red bob, gold rings on every finger, bright lipstick.
- В кадрах: В5-01.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 45 | 2008 | digital | travel agency owner of 45, dyed red bob, gold rings |

### `vika` — Вика из Барнаула (1986 г. р., эпизод)
- Из текста: 26 лет, менеджер салона связи (В5-05).
- (додумано) веснушки (из промпта), светлые волосы.
- **Ядро сходства:** freckles, light hair, nervous hands.
- В кадрах: В5-05.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 26 | 2012 | digital | Russian woman of 26 in a wetsuit, freckles |

### `ploy_mother` — Мать Плой (1956 г. р., эпизод)
- Из текста: машет с балкона, клетка с курами; покупала рясу (В5-04, В5-06).
- (додумано) сухая, седой пучок.
- **Ядро сходства:** thin Thai woman, grey hair in a bun, sharp eyes.
- В кадрах: В5-04.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 55 | 2011 | digital | Thai woman of 55, grey bun, cotton blouse |

### `luangpho_thong` — Луангпхо Тхонг (1934 г. р., эпизод)
- Из текста: «за восемьдесят, худой и тёмный, как сушёная рыба» (В5-06).
- (додумано) —.
- **Ядро сходства:** very thin old Thai monk, shaved head, dark leathery skin.
- В кадрах: В5-06.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 80 | 2015 | digital | old Thai monk of 80+, orange robe slipping off one shoulder |

### `somchai` — Сомчай (1957 г. р., эпизод)
- Из текста: «шестьдесят лет, футболка Ливерпуля» (В5-07); в промпте без логотипа.
- (додумано) улыбка с сигаретой.
- **Ядро сходства:** Thai man, round smiling face, short grey hair.
- В кадрах: В5-07.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 60 | 2017 | digital | Thai man of 60 in a faded red football shirt without logos, cigarette |

### `henk` — Хенк (1965 г. р., эпизод)
- Из текста: голландец, 80, инженер дамб, белый халат, бокал (В5-11).
- (додумано) лысина, белые усы.
- **Ядро сходства:** tall old white man, bald crown, white moustache.
- В кадрах: В5-11.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 80 | 2045 | phone | old Dutchman of 80 in a white bathrobe holding a glass |

### `matvey` — Матвей (1979 г. р., эпизод)
- Из текста: «рыжий, бородатый», бывший программист (В6-04).
- (додумано) —.
- **Ядро сходства:** ginger beard, ginger hair, big backpack.
- В кадрах: В6-04.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 30 | 2009 | digital | hiker of 30 with a ginger beard and a large backpack |

### `varya` — Варя (2011 г. р., эпизод)
- Из текста: дочь в В7, 22 года, уезжает в Академгородок (В7-09); в семье девочки левши.
- (додумано) тёмный хвост, отцовских черт не даём.
- **Ядро сходства:** young woman, dark ponytail, determined face, left-handed.
- В кадрах: В7-09.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| 22 | 2033 | phone | young woman of 22 in sneakers and a light jacket, dark ponytail |

### `bublik` — Бублик (щенок) (1996 г. р., эпизод)
- Из текста: рыжий щенок (Т-01); вырос в «рыжего лопоухого кобеля» (Т-06).
- (додумано) белая звёздочка на груди.
- **Ядро сходства:** ginger mongrel dog with floppy ears and a white star on the chest.
- В кадрах: Т-01.

| возраст | годы сцен | эпоха эталона | облик (EN) |
|---|---|---|---|
| puppy | 1996 | bw | ginger mongrel puppy, floppy ears, white star on the chest |
<!-- cards:end -->

## 6. Спорные кадры (зависят от флагов или требуют решения автора)

- **В7-10** «Лестница»: на подоконнике сидит жена. Это Ника (В7.1) или Оля (В7.2), а картинка одна на сцену. Каст пустой, лицо в промпте не уточнено.
- **В6-08** «Иордань»: седой человек в белой рубахе на коленях — Витька только при `F_В605 = ВИТЬКА`. Иначе это незнакомец, но внешне он подходит. В касте `vitka:43`.
- **В1-05** «Гаражи»: седой в футболке спасателя — Палыч (по промпту). В тексте у гаража курит отец; если нужен отец, поменяй каст на `father:49` и добавь возраст.
- **В5-09**: в видеозвонке лицо Соньки в маске, мама — на заднем плане.
- **Ф-02**: женская рука без лица. Партнёр зависит от ветви, поэтому каст пустой.
- **Т-05**: снимок 1981 года; это фото внутри мира, поэтому эпоха `bw`.
- Невидимые в кадрах (карточки при появлении кадров): бабушка (хранит штормовку и Тетрадь), Оля, Колька, внук Андрюша (в В7-12 только его резиновые сапожки), Мали, тесть (В7-04 — размытое красное лицо, без эталона).
