#!/usr/bin/env python3
"""Карточки персонажей → docs/generated/characters.csv, docs/generated/scene_cast.csv
и раздел карточек в docs/05_visual.md (между маркерами <!-- cards:begin/end -->).

Данные персонажей живут ТОЛЬКО здесь (CHARS, CAST). Поменял внешность — запусти:
    python3 tools/build_cast.py
Источник промптов сцен — docs/generated/image_prompts.csv (tools/export_prompts.py).
Героя (Андрея) не описываем никогда: только его руки (HANDS).
"""
import csv
import re
import sys

from artstyle import ERA_MEDIUM, REF_COMMON, REF_MEDIUM, PLACEHOLDER, COMMON
from qqparse import ROOT, load

# ---------------------------------------------------------------- персонажи
# core — «ядро» сходства, одинаковое во всех возрастах (EN).
# ages: возраст → (годы сцен, эпоха эталона, полный облик EN, короткий облик EN для сцены)
# src — откуда взято (RU), invented — что додумано (RU).
CHARS = {
    "nika": dict(
        ru="Ника", born=1989, tier="main",
        src="«лицо серьёзное, как у завуча», панамка с вишнями (Т-01); брекеты, Стругацкие (Т-06); короткая стрижка, Витькина куртка (В1-05, В2-05); седая, коротко стриженная, очки на цепочке (В1-12)",
        invented="серо-зелёные глаза, прямые тёмные брови, родинка над левым краем верхней губы, каштановые волосы",
        core="oval face with a narrow pointed chin, serious level gaze like a strict head teacher, straight dark eyebrows, grey-green eyes, a small mole above the left corner of the upper lip, chestnut hair, slim",
        ages={
            7: ("1996", "bw", "7-year-old girl, chestnut chin-length bob under a white child's panama hat printed with cherries, simple cotton sundress, scraped knees", "a serious 7-year-old girl, chestnut bob, cherry-print panama hat"),
            13: ("2002", "color", "13-year-old girl, plain and ordinary-looking, not pretty, an awkward bony teenager with a serious strict face, chestnut hair in a low ponytail, metal braces, oversized t-shirt, a paperback book in hand", "a 13-year-old girl, chestnut ponytail, braces"),
            18: ("2007", "digital", "18-year-old girl, plain and serious, chestnut hair to the shoulders tied back, no braces any more, simple cardigan, a stack of university entrance books", "a serious 18-year-old girl with chestnut hair tied back"),
            22: ("2011–2014", "digital", "young woman of 22-25, chestnut pixie cut, an oversized men's jacket over her shoulders or a white lab coat, no make-up", "a young woman of about 23, short chestnut pixie cut, strict calm face"),
            56: ("2045", "phone", "woman of 56, short-cropped grey hair, reading glasses on a thin chain, white doctor's coat, tired lines around the eyes", "a woman doctor of 56, cropped grey hair, glasses on a chain"),
        }),
    "vitka": dict(
        ru="Витька", born=1988, tier="main",
        src="«рыжий в крапинку», орёт громче всех (Т-01); краснеют уши (Т-06); бритый на проводах (Т-09); шахтёр (В1); поседел, белая рубаха поверх свитера (В6-08)",
        invented="светло-голубые глаза, курносый нос, широкая щербатая улыбка, оттопыренные уши, коренастый",
        core="round freckled face, snub nose, light blue eyes, wide grin with a small gap between the front teeth, ears that stick out and go red, ginger hair, stocky build",
        ages={
            8: ("1996", "bw", "8-year-old boy, shaggy ginger hair, dense freckles, skinny, shorts and a stretched t-shirt", "a freckled 8-year-old boy with shaggy ginger hair"),
            14: ("2002", "color", "14-year-old boy, ginger hair grown out, freckles, squinting, navy tracksuit top with two white stripes", "a 14-year-old ginger freckled boy, squinting"),
            18: ("2006", "color", "18-year-old conscript, freshly shaved head with ginger stubble, red flushed face, freckles, white shirt", "a shaved-head ginger 18-year-old with a red face"),
            23: ("2011–2014", "digital", "man of 23-26, short ginger hair, freckles, stocky miner's build, track jacket or a cheap black suit", "a stocky ginger man of about 24, freckles, loud grin"),
            33: ("2021", "phone", "miner of 33, short ginger hair under a dirty helmet, freckles under coal dust, heavy jaw, ginger stubble", "a ginger miner of 33, freckles under coal dust"),
            43: ("2031", "phone", "man of 43, hair and short beard gone completely grey with a trace of ginger, freckles, sober calm face, white shirt over a sweater", "a grey-bearded man of 43 with freckles, white shirt over a sweater"),
        }),
    "father": dict(
        ru="Отец, Николай Тихонович", born=1962, tier="main",
        src="ГРОЗ на «Глубокой», рабочая куртка (В6-03); «весь седой» в 57 (В6-07); седой ёжик, инсульт (В1-10); старик у заводи «лицом похож на папу» (Т-03)",
        invented="длинное худое лицо, тяжёлые надбровья, глубоко посаженные серые глаза, нос с давним переломом, усы до 2000-х",
        core="long lean face, heavy brow, deep-set grey eyes, a straight nose with an old break, thin lips, coal dust in the creases of the skin, big knotted miner's hands, wiry build",
        ages={
            34: ("1996", "bw", "miner of 34, short dark hair, dark moustache, tired face, work jacket", "a tired miner of 34, short dark hair, moustache"),
            45: ("2007", "digital", "miner of 45, dark hair greying at the temples, clean-shaven, worn work jacket", "a tired miner of 45, greying temples, work jacket"),
            59: ("2019–2023", "phone", "retired miner of 57-61, completely grey crew cut, grey stubble, deep lines, flannel shirt", "a retired miner about 60, completely grey crew cut"),
            65: ("2027", "phone", "old man of 65, grey crew cut, one side of the face slack after a stroke, hospital gown", "an old man of 65 with a grey crew cut, face slack on one side"),
        }),
    "mother": dict(
        ru="Мама, Валентина", born=1966, tier="main",
        src="серые глаза («серые, мамины», Ф-03); флотатор ЦОФ, волосы пахнут углём; маленькая, в чёрном платке (В5-09); платок в цветочек, крошечная старушка (В5-13)",
        invented="круглое мягкое лицо, ямочка на подбородке, шатенка с химической завивкой в 90-е",
        core="small and short, soft round face, a dimple in the chin, grey eyes, light-brown hair",
        ages={
            30: ("1996–2000", "bw", "woman of 30, small, light-brown permed hair, a dark work robe of a coal processing plant worker, tired kind face", "a small woman of 30 with permed light-brown hair"),
            41: ("2007", "digital", "woman of 41, light-brown hair under a headscarf, light jacket, small and tired", "a small woman of 41 in a headscarf"),
            54: ("2020", "phone", "woman of 54, small, black mourning headscarf, medical mask, grey eyes", "a small woman of 54 in a black headscarf and a medical mask"),
            95: ("2061", "future", "tiny very old woman of 95, white hair under a flowered headscarf, soft wrinkled round face, grey eyes", "a tiny very old woman in a flowered headscarf"),
        }),
    "sonka": dict(
        ru="Сонька", born=1998, tier="main",
        src="фиолетовые пряди, плеер (В6-05); студентка-медик; глаза серые, мамины (Ф-03); седая, в мамином платке в цветочек (В6-13)",
        invented="мамино круглое лицо, вздёрнутая верхняя губа, веснушки нет",
        core="round face like her mother's, grey eyes, slightly upturned upper lip, light-brown hair, quick sharp look",
        ages={
            13: ("2010–2012", "digital", "girl of 12-14, light-brown hair with dyed purple streaks, earphones, hoodie", "a girl of 13 with purple streaks in her light-brown hair"),
            22: ("2020", "phone", "young woman of 22, medical student, hair tied back, medical mask, wet angry grey eyes", "a young woman of 22 in a medical mask, angry grey eyes"),
            63: ("2061", "future", "woman of 63, grey hair, her mother's flowered headscarf, grey eyes, warm smile lines", "a grey-haired woman of 63 in a flowered headscarf"),
        }),
    "lunev": dict(
        ru="Вадим Петрович Лунёв", born=1956, tier="main",
        src="«молодой и худой, с портфелем» (Т-05); всё время трёт глаза, серый костюм (Т-02б); поседел до белого (В2-07); маленький, как подросток, очки на шнурке (В2.1-07)",
        invented="узкое лицо, высокий лоб, светлые близорукие глаза, очки в тонкой оправе всю жизнь",
        core="narrow face, high forehead, pale short-sighted eyes, thin wire-rimmed glasses, thin build, habit of rubbing his eyes",
        ages={
            25: ("1981", "bw", "thin young man of 25, dark side-parted hair, wire glasses, cheap suit, holding a briefcase", "a thin young man of 25 in glasses with a briefcase"),
            40: ("1996", "bw", "thin pale man of 40 who looks nearly sixty, greying dark hair, wire glasses, worn grey suit, no white coat, worn briefcase", "a thin pale man of about 40 in wire glasses and a grey suit"),
            60: ("2016–2017", "digital", "man of 60, hair gone completely white, wire glasses, tired eyes, good dark coat", "a white-haired man of 60 in wire glasses, tired eyes"),
            85: ("2041", "phone", "very old shrunken man of 85, wispy white hair, glasses hanging on a cord, thin as a teenager", "a very old thin man of 85, glasses on a cord"),
        }),
    "grandpa": dict(
        ru="Дед, Тихон Савельевич", born=1930, tier="main",
        src="«в очках и шляпе, похожий на папу, только старше» (Т-05); регент хора «Рудничный» с камертоном (В7-11)",
        invented="отцовское длинное лицо, тяжёлые надбровья, очки в роговой оправе",
        core="long lean face like his son's, heavy brow, deep-set eyes behind horn-rimmed glasses, straight nose",
        ages={
            51: ("1981", "bw", "man of 51, horn-rimmed glasses, a soft brimmed hat, plain jacket, looks like a miner", "an older man of 51 in horn-rimmed glasses and a hat"),
        }),
    "shadrin": dict(
        ru="Шадрин", born=1948, tier="main",
        src="«вежливый мужик под семьдесят в хорошем пальто», сухая тёплая рука; кожаный блокнот, золотая ручка (В2-07, В2.1-00)",
        invented="аккуратно зачёсанные назад серебряные волосы, гладко выбрит, бледно-голубые глаза, тонкая улыбка",
        core="neat silver hair combed back, clean-shaven, pale blue eyes, thin polite smile, upright posture",
        ages={
            68: ("2016", "phone", "man of 68, expensive dark wool coat, white shirt, leather notebook and a gold pen", "a polite silver-haired man of 68 in an expensive coat"),
        }),
    "ploy": dict(
        ru="Плой", born=1986, tier="main",
        src="тайка из Нонтхабури, «стрижена почти налысо», смеётся глазами; белый открытый шлем, футболка дайв-школы (В5-03)",
        invented="широкие скулы, тёмно-карие глаза, родинка на шее слева, жилистая",
        core="Thai woman, very short almost shaved black hair, broad cheekbones, dark brown laughing eyes, a small mole on the left side of the neck, wiry athletic build",
        ages={
            24: ("2010–2012", "digital", "Thai woman of 24-26, almost shaved head, dive school t-shirt, tanned", "a young Thai woman with almost shaved hair, dive t-shirt"),
            36: ("2022", "phone", "Thai woman of 36, very short black hair, apron, laughing", "a Thai woman of 36 with very short hair, laughing"),
        }),
    "dasha": dict(
        ru="Даша Веснина", born=2037, tier="main",
        src="серьёзная, наушники, рисует круги один в другом (В2.2-05); позже короткая стрижка, тетрадь в клеёнке",
        invented="бледное худое лицо, тёмные круги под глазами (почти не спит), прямые тёмные волосы до плеч",
        core="pale thin face, dark rings under the eyes, very straight serious stare, straight dark hair",
        ages={
            12: ("2049", "phone", "girl of 12, shoulder-length straight dark hair, big headphones, school uniform", "a pale serious girl of 12 with big headphones"),
        }),
    "gleb": dict(
        ru="Глеб Ростоцкий", born=1990, tier="main",
        src="«худой и острый, как циркуль», бледный (В2-06)",
        invented="чёрные волосы, впалые щёки, светло-серые глаза",
        core="very thin, sharp angular features, hollow cheeks, pale skin, light grey eyes, black hair",
        ages={
            24: ("2014", "digital", "young man of 24, messy black hair, hoodie, nervous intense smile", "a thin pale young man of 24 with sharp features"),
        }),
    "anna_markovna": dict(
        ru="Анна Марковна", born=1957, tier="main",
        src="«лет пятьдесят, очки висят на шнурке», белый халат, подстаканник (В6-01)",
        invented="полная, короткая тёмная стрижка с проседью, строгий рот, добрые глаза",
        core="plump, short dark hair with grey streaks, strict mouth, kind brown eyes, glasses on a cord",
        ages={
            50: ("2007", "digital", "psychiatrist of 50, white coat, glasses on a cord", "a woman doctor of 50, glasses on a cord, white coat"),
        }),
    "serafim": dict(
        ru="Отец Серафим", born=1941, tier="main",
        src="«маленький, сухой, с бородой до пояса», ходит быстро; бывший бас хора (В6-06)",
        invented="возраст ~75, светлые выцветшие глаза, нос картошкой",
        core="small and wiry, waist-long grey beard, faded light eyes, bulbous nose, weathered skin",
        ages={
            75: ("2016", "digital", "old monk of about 75, patched black cassock, waist-long grey beard", "a small old monk with a waist-long grey beard, patched black cassock"),
        }),
    "tanya": dict(
        ru="Таня-ламповщица", born=1987, tier="main",
        src="«двадцать два, чёлка выкрашена в баклажан» (В1-01)",
        invented="круглое лицо, ямочки, карие глаза",
        core="round face, dimples, brown eyes, hair with a dyed aubergine-purple fringe",
        ages={
            22: ("2009", "digital", "young woman of 22, aubergine-dyed fringe, blue work smock", "a young woman with a dyed aubergine fringe"),
        }),
    # ---- эпизодические (по одному кадру)
    "palych": dict(ru="Палыч", born=1959, tier="episodic",
        src="седой командир отделения ВГСЧ, «голос как из бочки» (В1-04, В1-05)", invented="широкое лицо, перебитый нос",
        core="broad face, broken nose, grey hair cut short, barrel chest",
        ages={52: ("2011", "digital", "mine rescue commander of 52, grey hair, rescue squad t-shirt", "a grey-haired barrel-chested man in a rescue squad t-shirt")}),
    "seryoga": dict(ru="Серёга", born=1988, tier="episodic",
        src="напарник, балагур, муж Ники в В1 (В1-05, В1-06)", invented="коренастый, тёмный ёжик, щёки",
        core="stocky, dark buzz cut, round cheeks, cheerful storyteller face",
        ages={23: ("2011", "digital", "young miner of 23, dark buzz cut, stocky", "a stocky young miner with a dark buzz cut, telling a story")}),
    "mikhalych": dict(ru="Михалыч", born=1951, tier="episodic",
        src="«сорок лет под землёй, руки похожи на корни» (В1-01)", invented="седые усы, сутулый",
        core="stooped old miner, grey moustache, hands like roots",
        ages={58: ("2009", "digital", "old miner of 58 in a helmet and dirty work clothes, grey moustache", "an old stooped miner with a grey moustache, seen as a silhouette")}),
    "polina": dict(ru="Полина, оператор «Девятки»", born=1993, tier="episodic",
        src="«девчонка из Подольска с секундомером на шее» (В2.1-01)", invented="светлый хвост, веснушки нет, деловитая",
        core="young woman, blond ponytail, businesslike face",
        ages={25: ("2017", "phone", "operator of 25, blond ponytail, stopwatch on a cord, lab coat", "a young blonde operator with a stopwatch on her neck")}),
    "den": dict(ru="Дэн из Северска", born=1989, tier="episodic",
        src="«рассказывает и сам ржёт громче всех» (В2-01)", invented="длинный, вихрастый, спортивный костюм",
        core="lanky, tousled light hair, big laugh",
        ages={18: ("2007", "digital", "lanky student of 18 in a tracksuit, tousled hair", "a lanky laughing student in a tracksuit")}),
    "alla_borisovna": dict(ru="Алла Борисовна", born=1963, tier="episodic",
        src="«рыжее каре и золотые кольца на каждом пальце» (В5-01)", invented="яркая помада",
        core="dyed red bob, gold rings on every finger, bright lipstick",
        ages={45: ("2008", "digital", "travel agency owner of 45, dyed red bob, gold rings", "a woman of 45 with a dyed red bob and gold rings")}),
    "vika": dict(ru="Вика из Барнаула", born=1986, tier="episodic",
        src="26 лет, менеджер салона связи (В5-05)", invented="веснушки (из промпта), светлые волосы",
        core="freckles, light hair, nervous hands",
        ages={26: ("2012", "digital", "Russian woman of 26 in a wetsuit, freckles", "a freckled young Russian woman in a wetsuit")}),
    "ploy_mother": dict(ru="Мать Плой", born=1956, tier="episodic",
        src="машет с балкона, клетка с курами; покупала рясу (В5-04, В5-06)", invented="сухая, седой пучок",
        core="thin Thai woman, grey hair in a bun, sharp eyes",
        ages={55: ("2011", "digital", "Thai woman of 55, grey bun, cotton blouse", "an older Thai woman with a grey bun")}),
    "luangpho_thong": dict(ru="Луангпхо Тхонг", born=1934, tier="episodic",
        src="«за восемьдесят, худой и тёмный, как сушёная рыба» (В5-06)", invented="—",
        core="very thin old Thai monk, shaved head, dark leathery skin",
        ages={80: ("2015", "digital", "old Thai monk of 80+, orange robe slipping off one shoulder", "a very thin old Thai monk, dark leathery skin")}),
    "somchai": dict(ru="Сомчай", born=1957, tier="episodic",
        src="«шестьдесят лет, футболка Ливерпуля» (В5-07); в промпте без логотипа", invented="улыбка с сигаретой",
        core="Thai man, round smiling face, short grey hair",
        ages={60: ("2017", "digital", "Thai man of 60 in a faded red football shirt without logos, cigarette", "a smiling old Thai man in a faded football shirt")}),
    "henk": dict(ru="Хенк", born=1965, tier="episodic",
        src="голландец, 80, инженер дамб, белый халат, бокал (В5-11)", invented="лысина, белые усы",
        core="tall old white man, bald crown, white moustache",
        ages={80: ("2045", "phone", "old Dutchman of 80 in a white bathrobe holding a glass", "a tall old white man in a bathrobe")}),
    "matvey": dict(ru="Матвей", born=1979, tier="episodic",
        src="«рыжий, бородатый», бывший программист (В6-04)", invented="—",
        core="ginger beard, ginger hair, big backpack",
        ages={30: ("2009", "digital", "hiker of 30 with a ginger beard and a large backpack", "a ginger-bearded hiker, blurred in fog")}),
    "varya": dict(ru="Варя", born=2011, tier="episodic",
        src="дочь в В7, 22 года, уезжает в Академгородок (В7-09); в семье девочки левши", invented="тёмный хвост, отцовских черт не даём",
        core="young woman, dark ponytail, determined face, left-handed",
        ages={22: ("2033", "phone", "young woman of 22 in sneakers and a light jacket, dark ponytail", "a young woman of 22 with a dark ponytail, partly in frame")}),
    "bublik": dict(ru="Бублик (щенок)", born=1996, tier="episodic",
        src="рыжий щенок (Т-01); вырос в «рыжего лопоухого кобеля» (Т-06)", invented="белая звёздочка на груди",
        core="ginger mongrel dog with floppy ears and a white star on the chest",
        ages={0: ("1996", "bw", "ginger mongrel puppy, floppy ears, white star on the chest", "a ginger puppy with floppy ears")}),
    # Коряга-рука — единый символ во всех кадрах (решение автора 06.11.2026): эталон-предмет, подкладывается автоматически.
    "snag": dict(ru="Коряга-рука", born=0, tier="main", object=True,
        src="«белая и гладкая, растопыренная, как пятерня» (Т-00); «белая коряга, похожая на руку» (Я-01, В5, В7)", invented="наклон ствола",
        core="a single dead tree snag, bleached bone-white and polished smooth by water, one thick trunk rising at a slight tilt and ending in five spread crooked branches, exactly like the open fingers of a hand reaching up",
        ages={0: ("all", "color", "a single dead tree snag, bleached bone-white and polished smooth by water, one thick trunk rising at a slight tilt and ending in five spread crooked branches, exactly like the open fingers of a hand reaching up", "the white bone-smooth snag shaped like an open five-fingered hand")}),
}

AGE_LABEL = {("bublik", 0): "puppy", ("snag", 0): "ref"}

# ---------------------------------------------------------------- кто в кадре
CAST = {
    "Я-02": ["nika:7"],
    "Т-01": ["vitka:8", "nika:7", "bublik:puppy"],
    "Т-05": ["grandpa:51", "lunev:25"],
    "Т-06": ["vitka:14", "nika:13"],
    "Т-02б": ["lunev:40"],
    "Т-07": ["vitka:14"],
    "Т-09": ["vitka:18"],
    "Ф-04": ["father:34"],
    "В1-01": ["tanya:22"],
    "В1-02": ["mikhalych:58"],
    "В1-05": ["vitka:23", "nika:22", "seryoga:23", "palych:52"],
    "В1-06": ["nika:22", "vitka:23"],
    "В1-09": ["vitka:33"],
    "В1-10": ["father:65"],
    "В1-12": ["nika:56"],
    "В2-01": ["den:18"],
    "В2-05": ["nika:22"],
    "В2-06": ["gleb:24"],
    "В2-07": ["lunev:60"],
    "В2.1-00": ["shadrin:68"],
    "В2.1-01": ["polina:25", "lunev:60"],
    "В2.1-07": ["lunev:85"],
    "В2.2-02": ["father:59"],
    "В2.2-05": ["dasha:12"],
    "В5-01": ["alla_borisovna:45"],
    "В5-03": ["ploy:24"],
    "В5-04": ["ploy:24", "ploy_mother:55"],
    "В5-05": ["vika:26", "ploy:24"],
    "В5-06": ["luangpho_thong:80"],
    "В5-07": ["somchai:60"],
    "В5-09": ["sonka:22", "mother:54"],
    "В5-10": ["ploy:36"],
    "В5-11": ["henk:80"],
    "В5-13": ["mother:95"],
    "В6-01": ["anna_markovna:50"],
    "В6-03": ["father:45", "mother:41"],
    "В6-04": ["matvey:30"],
    "В6-05": ["sonka:13"],
    "В6-06": ["serafim:75"],
    "В6-07": ["father:59"],
    "В6-08": ["vitka:43"],
    "В6-13": ["sonka:63"],
    "В7-02": ["sonka:13"],
    "В7-09": ["varya:22"],
    "В7-11": ["grandpa:51"],
    "Ф-03": ["sonka:63"],
}

# Правки промптов, где исходник показывает героя (канон п. 24: героя не показываем).
FIX = {
    "Я-02": [("", "; the drowned boy's face is turned away and hidden, only his small body and wet hair are visible")],
    "Ф-03": [("a faded enamel photo of a smiling 7-year-old boy", "a weathered enamel portrait so faded that the boy's face cannot be made out")],
    "Ф-04": [("an old man in a wet striped sailor shirt beside him",
              "seen through the eyes of the old man standing beside him: only the old man's own wrinkled scarred hand in a wet striped sailor sleeve reaching for one cup, first-person view")],
}
# Детали из текста сцен, которых нет в промпте (только гарантированные на всех путях, I3).
EXTRA = {
    "В7-11": "the man raising the tuning fork in the choir photo wears horn-rimmed glasses",
}

HANDS_RE = re.compile(r"\bpalm\b|\b(old man's|man's|a boy's|scarred old|hands? (with|holding|in)|his hands)\b[^,]*\bhands?\b|\bhands? (with|holding)\b", re.I)
NO_SCAR_RE = re.compile(r"glove|mitten|scar|bandage", re.I)


def hands_note(age):
    if age < 18:
        return "the narrator's own young hand has a thin pale scar across the right palm from the base of the thumb to the wrist"
    if age < 60:
        return "the narrator's own right palm has a long pale scar from the base of the thumb to the wrist"
    return "the narrator's own old wrinkled right hand has a long pale scar from the base of the thumb to the wrist"


def label(cid, age):
    return AGE_LABEL.get((cid, age), str(age))


def parse_cast(token):
    cid, a = token.split(":")
    age = 0 if a in ("puppy", "ref") else int(a)
    return cid, age


def ref_file(cid, age):
    return f"game/img/ref/{cid}_{label(cid, age)}.png"


MARK_RE = re.compile(r"mole|dimple|scar|birthmark|gap between|freckle", re.I)


def marks(cid):
    """Приметы (родинки, ямочки, шрамы, щербинка, веснушки) из core: обязательны в любом возрасте."""
    return [p.strip() for p in CHARS[cid]["core"].split(",") if MARK_RE.search(p)]


def ref_prompt(cid, age):
    c = CHARS[cid]
    years, era, look, _ = c["ages"][age]
    if c.get("object"):
        return (f"{look}. Object reference: the snag alone, whole, standing in shallow still water, seen from the side, "
                f"plain light-grey background, nothing else. Drawing style: {PLACEHOLDER}. Medium: {REF_MEDIUM}. "
                "full-bleed image, no text, no watermark")
    m = marks(cid)
    must = (f" Distinctive marks that MUST be clearly visible (they stay the same at every age): {'; '.join(m)}." if m else "")
    return (f"{look}. Permanent features: {c['core']}.{must} Drawing style: {PLACEHOLDER}. "
            f"Medium: {REF_MEDIUM}. {REF_COMMON}")


def main():
    G = load()
    out = ROOT / "docs" / "generated"
    # characters.csv
    rows = []
    for cid, c in CHARS.items():
        for age, (years, era, look, short) in c["ages"].items():
            rows.append({"char_id": cid, "age": label(cid, age), "years": years, "ref_file": ref_file(cid, age),
                         "prompt": ref_prompt(cid, age), "tier": c["tier"], "era": era})
    with open(out / "characters.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["char_id", "age", "years", "ref_file", "prompt", "tier", "era"])
        w.writeheader(); w.writerows(rows)

    # scene_cast.csv
    src = list(csv.DictReader(open(out / "image_prompts.csv", encoding="utf-8")))
    srows, long_ = [], []
    for r in src:
        sid = r["id"]
        base, _, _ = r["prompt"].partition(" Drawing style:")
        base = base.rstrip(". ")
        for old, new in FIX.get(sid, []):
            base = base + new if old == "" else base.replace(old, new)
        cast = list(CAST.get(sid, []))
        if re.search(r"\bsnag\b", base, re.I) and "snag:ref" not in cast:
            cast.append("snag:ref")
        bits = []
        for tok in cast:
            cid, age = parse_cast(tok)
            c = CHARS[cid]
            short = c["ages"][age][3]
            name = c["ru"].split(",")[0].split(" (")[0]
            if c.get("object"):
                bits.append(f"{short}, exactly the same snag as in its reference image (snag)")
                continue
            m = marks(cid)
            bits.append(f"{short}" + (f", with {' and '.join(m)}" if m else "") + f" ({cid})")
        sc = G["scenes"].get(sid, {})
        sage = int(sc.get("age") or 30)
        if HANDS_RE.search(base) and not NO_SCAR_RE.search(base):
            bits.append(hands_note(sage))
        if sage < 16 and HANDS_RE.search(base):
            # без подсказки модель рисует детям взрослые руки; руки — только если сцена их называет (решение автора 06.11.2026)
            bits.append(f"the narrator's hand is the small smooth hand of a {sage}-year-old child, not an adult's")
        if sid in EXTRA:
            bits.append(EXTRA[sid])
        prompt = base + (". In frame: " + "; ".join(bits) if bits else "")
        prompt += f". Drawing style: {PLACEHOLDER}. Medium: {ERA_MEDIUM[r['era']]}. {COMMON}"
        if len(prompt) > 1100:
            long_.append((sid, len(prompt)))
        srows.append({"id": sid, "file": r["file"], "era": r["era"], "cast": ";".join(cast), "prompt": prompt})
    with open(out / "scene_cast.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "file", "era", "cast", "prompt"]); w.writeheader(); w.writerows(srows)

    unknown = [t for v in CAST.values() for t in v if parse_cast(t)[0] not in CHARS or parse_cast(t)[1] not in CHARS[parse_cast(t)[0]]["ages"]]
    missing = [k for k in CAST if k not in {r["id"] for r in src}]
    if unknown or missing:
        sys.exit(f"ошибка: неизвестные персонажи/возрасты {unknown}, сцены без промпта {missing}")

    # карточки в docs/05_visual.md
    md = ROOT / "docs" / "05_visual.md"
    cards = []
    for cid, c in CHARS.items():
        scenes = sorted({sid for sid, v in CAST.items() for t in v if parse_cast(t)[0] == cid})
        cards += [f"### `{cid}` — {c['ru']} ({c['born']} г. р., {'главный' if c['tier'] == 'main' else 'эпизод'})",
                  f"- Из текста: {c['src']}.", f"- (додумано) {c['invented']}.",
                  f"- **Ядро сходства:** {c['core']}.", f"- В кадрах: {', '.join(scenes)}.", "",
                  "| возраст | годы сцен | эпоха эталона | облик (EN) |", "|---|---|---|---|"]
        for age, (years, era, look, short) in c["ages"].items():
            cards.append(f"| {label(cid, age)} | {years} | {era} | {look} |")
        cards.append("")
    text = md.read_text(encoding="utf-8")
    a, b = "<!-- cards:begin -->", "<!-- cards:end -->"
    if a in text and b in text:
        text = text[:text.index(a) + len(a)] + "\n" + "\n".join(cards) + text[text.index(b):]
        md.write_text(text, encoding="utf-8")
    n_ages = len(rows)
    print(f"персонажей: {len(CHARS)}, эталонов (персонаж×возраст): {n_ages}, сцен с людьми: {len(CAST)} из {len(srows)}")
    for sid, n in long_:
        print(f"  длинный промпт: {sid} — {n} символов")


if __name__ == "__main__":
    main()
