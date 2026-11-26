/* Английский интерфейс (канон п. 39). Грузится только в английском режиме (window.QQ_LANG === "en"),
   после graph_en.js и до engine.js. Русская версия этот файл не видит и не меняется.

   Как работает: движок пишет интерфейс по-русски, как раньше; этот слой переводит то, что попало
   на экран. Словарь ключуется русской строкой (она и есть «ru» в паре ru→en):
   - EXACT — точная строка (после обрезки пробелов);
   - PAT — шаблоны для строк с числами и подстановками;
   - составные строки «a · b · c» и «…» в «ёлочках» переводятся по частям;
   - HTML — целые блоки прозы из index.html (вступление, «О чём игра», «Об игре и помощь», титры).
   Перевод идёт по текстовым узлам и атрибутам (aria-label, title, placeholder, alt) — сразу и через
   MutationObserver. Всё, что осталось с кириллицей, копится в window.QQ_I18N_MISSING (для e2e).
   window.QQ_T(s) — перевод строки для мест, где текст не попадает в DOM (canvas, «поделиться»). */
(function () {
  "use strict";
  var TITLE = "Black Backwater"; // рабочее английское название (канон п. 36); окончательное выбирает автор
  var TITLE_HTML = '<span class="h-a">Black</span><br><span class="h-b" data-t="Backwater">Backwater</span>';
  var CYR = /[А-Яа-яЁё]/;

  var STEP = { "один шаг": "one step", "два шага": "two steps", "три шага": "three steps", "четыре шага": "four steps", "пять шагов": "five steps" };
  var LACK = { "силы": "strength", "ума": "brains", "чуткости": "heart", "воли": "will", "дара": "gift", "сил": "strength", "упрямства": "stubbornness" };

  var EXACT = {
    // шапка и меню
    "Я": "Me", "Пути": "Paths", "Моя жизнь": "My Life", "Хор": "Choir", "Режим автора: состояние": "Author mode: state",
    "меню ↓": "menu ↓", "12 · Кемерово": "12 · Kemerovo", "Кемерово": "Kemerovo",
    "Кузбасс, 1996–2061. Одна жизнь, девять дорог и Хор тех, кем я был и кто не вернулся.": "The Kuzbass, 1996–2061. One life, nine roads, and a Choir of everyone I was who never came back.",
    "Продолжить": "Continue", "Новая жизнь": "New Life", "с лета 1996-го, мне семь": "from the summer of 1996, I'm seven",
    "Одна жизнь": "One Life", "как у всех людей: одна смерть, и отката нет": "like everyone else: one death, no rewind",
    "Разделы": "Sections", "О чём игра": "What this game is about", "Эверетт, квантовое бессмертие и правила дара": "Everett, quantum immortality and the rules of the gift",
    "Тетрадь Хора": "The Choir Notebook", "все, кем я был и кто не вернулся": "everyone I was who never came back",
    "все развилки: что прожито, а что ещё в тумане": "every fork: what I've lived and what's still in the fog",
    "дороги к финалам, где я уже был или куда иду": "roads to endings I've reached or am heading for",
    "Письмо деда": "Grandfather's Letter", "что на самом деле происходит. Все разгадки": "what's really going on. Every answer",
    "Дополнение · «Трое до рассвета»": "Expansion · Three Before Dawn (Russian only)",
    "ночь без откатов: успеть спасти троих, пока молва не дошла до участкового": "a night with no rewinds: save three people before the rumor reaches the local cop",
    "Дополнение · «Сорок первая строка»": "Expansion · The Forty-First Line (Russian only)",
    "ночь Глеба Ростоцкого: дрейф, Реестр везунчиков и мир, где мама жива": "Gleb Rostotsky's night: the Drift, the Registry of the Lucky, and a world where Mom is alive",
    "звук: вкл": "sound: on", "звук: выкл": "sound: off", "об игре и помощь": "about & help", "ещё…": "more…", "титры": "credits",
    "сохранить прогресс в файл": "save progress to a file", "загрузить из файла": "load from a file", "код": "code", "Код": "Code", "ввести": "enter",
    "режим автора: вкл": "author mode: on", "режим автора: выкл": "author mode: off", "аналитика: вкл": "analytics: on", "аналитика: выкл": "analytics: off",
    "начать всё заново (стереть прогресс)": "start over (erase all progress)", "точно? нажми ещё раз — всё сотрётся": "sure? tap again and everything is erased",
    "Разрешить анонимную статистику? Без имени и почты: общие счётчики игроков («эту смерть получили…») и Яндекс Метрика.": "Allow anonymous statistics? No name, no email: shared player counters (\"this death was found by…\") and Yandex Metrica.",
    "разрешить": "allow", "нет": "no",
    "Стол у окна: лампа, детская панамка в вишнях, тельняшка, шахтёрская лампа с жетоном 246, письмо «Коле», наручные часы, камертон, всё на ворохе дедовых записок; за окном комета над шахтой": "A table by the window: a lamp, a child's panama hat with cherries, a striped sailor's shirt, a miner's lamp with tag 246, a letter \"For Kolya\", a wristwatch, a tuning fork, all on a heap of Grandfather's notes; outside, a comet over the mine",
    // предметы натюрморта
    "панамка": "the panama hat", "тельняшка": "the striped shirt", "часы": "the watch", "настольная лампа": "the desk lamp", "камертон": "the tuning fork",
    "окно": "the window", "шахтёрская лампа": "the miner's lamp", "письмо «Коле»": "the letter \"For Kolya\"",
    "поплавок": "a fishing float", "очки для чтения": "reading glasses", "сухая гвоздика": "a dried carnation", "пробка от «Жигулёвского»": "a Zhigulevskoye bottle cap",
    "гильза": "a shell casing", "двушка": "a two-kopeck coin", "огарок свечи": "a candle stub", "ещё не прожито": "not lived yet", "пусто": "empty",
    // вступление и согласие
    "Начать": "Begin", "В меню": "To the menu", "Разрешаю": "Allow", "Не сейчас": "Not now",
    // глава, сцена, выборы
    "Дальше": "Next", "Открыть Хор": "Open the Choir", "Открыть «Мою жизнь»": "Open My Life", "Титры": "Credits", "В главное меню": "Main menu", "в главное меню": "main menu",
    "≈ в другом мире всё было не так": "≈ in another world it was different", "◌ тело помнит": "◌ the body remembers", "◌ иначе, чем в прошлый раз": "◌ not like last time",
    "Хор помнит…": "The Choir remembers…", "Отката нет. И не надо.": "No rewind. And no need for one.", "Отката нет.": "No rewind.",
    "⋯ ты это уже прожил": "⋯ you've lived this already", "⋯ ты это уже видел": "⋯ you've seen this already",
    "Рыбаки молчат. Я почти никого из них не знаю, и они меня, кажется, тоже.": "The Fishermen are silent. I hardly know any of them, and I don't think they know me either.",
    "в другом мире я выбрал это": "in another world I chose this", "в прошлой жизни я выбрал это": "in a past life I chose this", "◌ память другой жизни": "◌ memory of another life",
    "не надо": "don't", "❄ холодок в затылке: здесь что-то не так": "❄ a chill at the back of my neck: something's wrong here", "◌ Хор о чём-то знает": "◌ the Choir knows something",
    "— — —": "— — —", "эта жизнь ещё пишется": "this life is still being written",
    "не хватает близости": "not close enough", "мир слишком сдвинулся": "the world has drifted too far", "мир ещё не сдвинулся": "the world hasn't drifted yet",
    "Хор ещё не знает столько смертей": "the Choir doesn't know that many deaths yet", "Хор ещё не прожил столько жизней": "the Choir hasn't lived that many lives yet",
    "в этой жизни этого не было": "that didn't happen in this life", "закрыто": "locked", "Я помню…": "I remember…", "ещё закрыто": "still locked",
    // смерть, пробуждение, лента
    "◀◀ держи, чтобы перемотать": "◀◀ hold to rewind", "Перемотать назад: удерживай или нажми": "Rewind: hold or tap", "▶ держи, чтобы вдохнуть": "▶ hold to breathe in",
    "28 ИЮЛЯ 1996, ОКОЛО ПОЛУДНЯ": "28 JULY 1996, AROUND NOON",
    "Воздух кончается раньше, чем темнота.": "The air runs out before the dark does.",
    "Сверху, через воду, тонкий девчачий голос считает: «…двадцать девять… тридцать…»": "From above, through the water, a thin girl's voice is counting: \"…twenty-nine… thirty…\"",
    "Потом чья-то рука хватает меня за майку раньше, чем кончается счёт.": "Then somebody's hand grabs my shirt before the counting runs out.",
    "Сверху, через воду, тонкий девчачий голос считает: «…сто девяносто… сто девяносто один…»": "From above, through the water, a thin girl's voice is counting: \"…one hundred ninety… one hundred ninety-one…\"",
    "Потом не остаётся ничего, даже счёта.": "Then there's nothing left, not even the counting.",
    "Андрей Николаевич Самохин": "Andrei Nikolayevich Samokhin", "7 лет. Чёрная заводь. Утонул у коряги.": "Age 7. Black Backwater. Drowned by the snag.",
    "Ника считает:": "Nika is counting:", "В ТОМ МИРЕ": "IN THAT WORLD", "Тот, кто остался": TITLE,
    "сохранить картинку": "save the image", "ВКонтакте": "VK", "↗ поделиться надгробием": "↗ share the headstone", "редкая": "rare",
    "Если тебе сейчас тяжело не только в игре — в разделе": "If things are hard for you outside the game too, the", "«Об игре и помощь»": "About & help",
    "есть телефоны, по которым ответят.": "section has numbers where someone will answer.",
    "■ держи. Отката не будет": "■ hold on. There will be no rewind",
    "Хор молчит. Этот я не встанет за минуту до смерти и ничего из неё не вынесет. Так умирают все остальные.": "The Choir is silent. This me won't wake up a minute before his death and won't take anything away from it. That's how everyone else dies.",
    "Та же минута. Только теперь я знаю, чем она кончается.": "The same minute. Only now I know how it ends.",
    "…и я снова здесь, на несколько шагов раньше. Тело ещё помнит, как умирало, а голова уже прикидывает, где я ошибся.": "…and I'm here again, a few steps earlier. My body still remembers dying, and my head is already working out where I went wrong.",
    "Вдохнуть": "Breathe in", "Посмотреть ленту": "Look at the tape", "Вдохнуть и остаться в этой минуте": "Breathe in and stay in this minute",
    "Хор помнит больше. Вернуться ещё дальше назад": "The Choir remembers more. Go back further", "Хор помнит": "The Choir remembers",
    "◀◀ тяни ленту или тронь засечку": "◀◀ pull the tape or touch a notch", "лента этой жизни": "the tape of this life", "сейчас": "now",
    "↩ здесь началось": "↩ it started here", "◌ отсюда тянется": "◌ it runs from here", "дар не дотягивается": "the gift can't reach this far",
    "дальше лента склеена": "beyond that the tape is spliced", "дальше Хор не помнит": "beyond that the Choir doesn't remember",
    "туда, где всё началось, дар пока не дотягивается": "the gift can't reach back to where it all started yet", "Остаться в этой минуте": "Stay in this minute",
    // «Моя жизнь», «Пути», Тетрадь, «Я»
    "выбирал": "chose", "видел": "saw", "не видел": "didn't see", "смерть в Журнале": "death in the Notebook", "эта жизнь": "this life", "финал": "ending",
    "туман: ещё не прожито": "fog: not lived yet", "Тапни по сцене — откроется карточка с её развилками.": "Tap a scene to open a card with its forks.",
    "Уменьшить": "Zoom out", "Увеличить": "Zoom in", "вписать": "fit", "я здесь": "I'm here", "к якорю": "to the anchor", "щипок, Ctrl+колесо, тяни": "pinch, Ctrl+wheel, drag",
    "Куда ведут дороги": "Where the roads lead",
    "Здесь только дороги, по которым я уже шёл: к финалам, где я был, и к тем, куда иду в этой жизни (до сегодняшнего дня, не дальше). Подсказки открываются по ступеням: каким надо стать, главные развилки, весь путь.": "Only the roads I've already walked are here: to endings I've reached, and to the ones I'm heading for in this life (up to today, no further). Hints open in steps: who to become, the key forks, the whole road.",
    "Те, кем я был. Каждая строка — я, который не вернулся.": "The ones I was. Every line is a me who never came back.",
    "№": "No.", "когда": "when", "где и как": "where and how", "кто видел": "who saw", "Звук": "Sound", "Об игре": "About",
    "← Все пути": "← All paths", "умереть и вернуться": "die and come back", "Подсказка: каким стать": "Hint: who to become", "Путь до сегодня": "The road so far",
    "Главные развилки": "Key forks", "Весь путь": "The whole road", "Развернуть": "Expand", "Свернуть": "Collapse", "Показать в «Моей жизни»": "Show in My Life",
    "Пока ни одной дороги. Проживи — и она появится здесь: финал, до которого дошёл, или тот, к которому идёшь.": "No roads yet. Live, and one will appear here: an ending you reached, or the one you're heading for.",
    "пригодилось": "came in handy", "ещё не пригодилось": "hasn't come in handy yet", "просто память": "just a memory", "◌ и в другой жизни": "◌ in another life too",
    "Что я знаю": "What I know", "около полудня": "around noon",
    "Чёрная заводь. Утонул в семь лет. Вытащили через 252 секунды.": "Black Backwater. Drowned at seven. Pulled out after 252 seconds.",
    "Ника считала вслух.": "Nika counted out loud.", "Тетрадь пока пустая.": "The Notebook is empty for now.",
    "Что я вынес": "What I took away", "Это осталось от смертей этой жизни. Эхо-выбор, открытый такой памятью, подписан ⟲.": "This is what the deaths of this life left behind. An echo choice opened by such a memory is marked ⟲.",
    "Что со мной было": "What happened to me", "Это помнит не только тот, кто это пережил. Это помнит сюжет.": "It isn't only the one who lived through it who remembers. The story remembers too.",
    "Жизнь ещё не начата.": "No life has been started yet.",
    "Как батя": "Like Dad", "Участок": "The Section", "Эталон": "The Standard", "Физфак": "Physics", "Сорок два": "Forty-Two", "Партия": "The Survey Party",
    "Сварной": "Welder", "Куда угодно": "Anywhere", "Голоса": "Voices", "Остаться": "Stay", "пролог": "prologue", "якорь": "anchor", "после": "after",
    "ФИНАЛ": "ENDING", "⊣ ТУПИК": "⊣ DEAD END", "ЯКОРЬ": "ANCHOR", "жизнь ?": "life ?", "смерть, которой ещё не было": "a death that hasn't happened yet",
    "Моя жизнь: схема всех развилок": "My Life: a map of every fork", "убрать": "clear", "смерть": "death", "Смерть, которой ещё не было.": "A death that hasn't happened yet.",
    "тупик": "dead end", "Этот финал ещё скрыт.": "This ending is still hidden.", "Ещё не прожито.": "Not lived yet.", "Закрыть": "Close", "одна жизнь": "one life",
    "откроется, когда пройдёшь жизнь горноспасателя до конца": "opens once you've lived the mine rescuer's life to the end",
    "откроется в режиме автора: 90 % финалов или код «регент»": "opens in author mode: 90% of endings or a secret code",
    "Начать заново?": "Start over?", "нажми ещё раз: эта жизнь оборвётся, Хор и «Моя жизнь» останутся": "tap again: this life will end, the Choir and My Life will stay",
    "Начать одну жизнь?": "Start One Life?",
    "Браузер не даёт прочитать сохранения.": "The browser won't let the game read saves.", "Сохранять пока нечего: ни одной жизни ещё не прожито.": "Nothing to save yet: no life has been lived.",
    "Прогресс сохранён в файл. Его можно загрузить на другом устройстве.": "Progress saved to a file. You can load it on another device.",
    "Файл не читается.": "The file can't be read.", "Это не файл сохранения этой игры.": "This isn't a save file for this game.", "заменить": "replace", "не надо": "don't",
    "Браузер не даёт записать сохранения.": "The browser won't let the game write saves.",
    "открыто: дополнение и письмо деда": "unlocked: the expansion and Grandfather's letter", "замки снова закрыты (кроме ?dev)": "locks closed again (except ?dev)",
    "все концы отмечены пройденными": "all endings marked as reached", "такого кода нет": "no such code",
    // «Детство», перечитать, титры
    "Детство": "Childhood", "Детство ты уже прожил, и не раз. Можно прожить его заново, а можно сразу перейти к выпускному.": "You've lived childhood before, more than once. You can live it again, or skip straight to graduation.",
    "Прожить детство заново": "Live childhood again", "Детство как в прошлый раз": "Childhood like last time", "Детство одним листом": "Childhood on one page",
    "все выборы детства на одном экране, без текста": "every childhood choice on one screen, no text", "К выпускному": "On to graduation",
    "лето 2007-го, мне восемнадцать": "summer 2007, I'm eighteen", "Назад к «Моей жизни»": "Back to My Life", "закрыть титры": "close the credits", "коснись — пауза": "tap to pause",
    // стихии (подсказки на точках Тетради)
    "вода": "water", "холод": "cold", "огонь": "fire", "воздух": "air", "порода": "rock", "люди": "people", "дорога": "the road",
    "А": "A", "Б": "B", "В": "C", "Г": "D", "Д": "E", "Е": "F", "Ж": "G", "З": "H", // буквы вариантов (LETTERS в движке)
    "Русский": "Русский",
    "ВОДА": "WATER", "ХОЛОД": "COLD", "ОГОНЬ": "FIRE", "ВОЗДУХ": "AIR", "ПОРОДА": "ROCK", "ЛЮДИ": "PEOPLE", "ДОРОГА": "ROAD"
  };

  function n(s) { return +s; }
  var PAT = [
    [/^мне (\d+)$/, function (m) { return "age " + m[1]; }],
    [/^◌ другая жизнь · (.*)$/, function (m) { return "◌ another life · " + T(m[1]); }],
    [/^в первый раз так же выбрали (\d+)% игроков(.*)$/, function (m) { return "the first time, " + m[1] + "% of players chose the same" + dev(m[2]); }],
    [/^сюда дошли (\d+)% игроков(?: \((\d+) из (\d+)\))?(?: · в среднем за ([\d.]+) \S+ и (\d+) \S+)?$/, function (m) {
      return m[1] + "% of players made it this far" + (m[2] ? " (" + m[2] + " of " + m[3] + ")" : "") + (m[4] ? " · on average after " + m[4] + " " + (n(m[4]) === 1 ? "life" : "lives") + " and " + m[5] + " " + (n(m[5]) === 1 ? "death" : "deaths") : "");
    }],
    [/^≈ в другом мире всё было не так · (.*)$/, function (m) { return "≈ in another world it was different · " + T(m[1]); }],
    [/^осталось (\d+) секунд, (.*)$/, function (m) { return m[1] + " seconds left, " + m[2]; }],
    [/^⏱ (\d+) с$/, function (m) { return "⏱ " + m[1] + " s"; }],
    [/^(не успеть · )?−(\d+) с$/, function (m) { return (m[1] ? "too late · " : "") + "−" + m[2] + " s"; }],
    [/^⟲ память: (.*)$/, function (m) { return "⟲ memory: " + m[1]; }],
    [/^◌ память другой жизни: (.*)$/, function (m) { return "◌ memory of another life: " + m[1]; }],
    [/^\+ в памяти: (.*)$/, function (m) { return "+ remembered: " + m[1]; }],
    [/^не хватает (.+)$/, function (m) { return "not enough " + m[1].split(/ (или|и) /).map(function (w) { return w === "или" ? "or" : w === "и" ? "and" : (LACK[w] || w); }).join(" "); }],
    [/^слишком много (.+)$/, function (m) { return "too much " + m[1].split(" и ").map(function (w) { return LACK[w] || w; }).join(" and "); }],
    [/^(.*) · хватило$/, function (m) { return m[1] + " · enough"; }],
    [/^(.*) · не хватило, выручило другое$/, function (m) { return m[1] + " · not enough, something else pulled me through"; }],
    [/^(.*) · не хватило$/, function (m) { return m[1] + " · not enough"; }],
    [/^дар дотягивается на (.+), дальше лента засвечена$/, function (m) { return "the gift reaches back " + (STEP[m[1]] || m[1]) + ", beyond that the tape is burned"; }],
    [/^эту смерть получили (\d+)% игроков(.*)$/, function (m) { return m[1] + "% of players got this death" + dev(m[2]); }],
    [/^Открыто сцен: (\d+) из (\d+)$/, function (m) { return "Scenes opened: " + m[1] + " of " + m[2]; }],
    [/^финалов:? (\d+) из (\d+)$/, function (m) { return "endings " + m[1] + " of " + m[2]; }],
    [/^смертей:? (\d+) из (\d+)$/, function (m) { return "deaths " + m[1] + " of " + m[2]; }],
    [/^…и я здесь: (.*)\. Дальше — не прожито\.$/, function (m) { return "…and I'm here: " + m[1] + ". Beyond this, not lived yet."; }],
    [/^Хор знает (\d+) смертей из (\d+)$/, function (m) { return "the Choir knows " + m[1] + " deaths of " + m[2]; }],
    [/^стихий (\d+) из (\d+)$/, function (m) { return "elements " + m[1] + " of " + m[2]; }],
    [/^прожито жизней:? (\d+)(?: из (\d+))?$/, function (m) { return "lives lived " + m[1] + (m[2] ? " of " + m[2] : ""); }],
    [/^Жизнь (\d+)$/, function (m) { return "Life " + m[1]; }],
    [/^жизнь (\d+)$/, function (m) { return "life " + m[1]; }],
    [/^Общий Хор: в среднем каждый из нас умирал (\d+) раза?\.(.*)$/, function (m) { return "The shared Choir: on average each of us has died " + m[1] + (n(m[1]) === 1 ? " time." : " times.") + dev(m[2]); }],
    [/^Моя самая редкая смерть: ✝ (.+), (\d{4}) — её нашли (\d+)% игроков(.*)\.$/, function (m) { return "My rarest death: ✝ " + T(m[1]) + ", " + m[2] + " — found by " + m[3] + "% of players" + dev(m[4]) + "."; }],
    [/^развилок: (\d+) из (\d+)$/, function (m) { return "forks: " + m[1] + " of " + m[2]; }],
    [/^дорожек открыто: (\d+) из (\d+)$/, function (m) { return "lanes open: " + m[1] + " of " + m[2]; }],
    [/^впереди: (\d+) финалов$/, function (m) { return "ahead: " + m[1] + " endings"; }],
    [/^(\d+) смертей$/, function (m) { return m[1] + " deaths"; }],
    [/^(\d+) сцен$/, function (m) { return m[1] + " scenes"; }],
    [/^Подсвечен путь к «(.+)»\.$/, function (m) { return "Highlighted: the road to “" + T(m[1]) + "”."; }],
    [/^в Журнале: (.*)$/, function (m) { return "in the Notebook: " + m[1]; }],
    [/^(.*?)(?: · )?ещё не найдено смертей: (\d+)$/, function (m) { return (m[1] ? T(m[1]) + " · " : "") + "deaths not found yet: " + m[2]; }],
    [/^откроется, когда увидишь (\d+) финала?о?в? из (\d+) \(сейчас (\d+)\)$/, function (m) { return "opens once you've seen " + m[1] + " of " + m[2] + " endings (now " + m[3] + ")"; }],
    [/^(\d+) (строка|строки|строк)$/, function (m) { return m[1] + (n(m[1]) === 1 ? " line" : " lines"); }],
    [/^В файле: прожито жизней (\d+), строк в Тетради Хора (\d+)(?:, сохранено ([\d-]+))?\. Текущий прогресс на этом устройстве заменится\.$/, function (m) {
      return "In the file: " + m[1] + " lives lived, " + m[2] + " lines in the Choir Notebook" + (m[3] ? ", saved " + m[3] : "") + ". Your current progress on this device will be replaced.";
    }],
    [/^Мне было (\d+)\. (.*)$/, function (m) { return "I was " + m[1] + ". " + m[2]; }],
    [/^режим автора: (вкл|выкл)$/, function (m) { return "author mode: " + (m[1] === "вкл" ? "on" : "off"); }],
    [/^В([\d.]+)$/, function (m) { return "L" + m[1]; }],
    [/^🔒 (.+)$/, function (m) { var r = tr(m[1]); return r == null ? null : "🔒 " + r; }],
    [/^режим автора: (\d+) финала?о?в? из (\d+)$/, function (m) { return "author mode: " + m[1] + " of " + m[2] + " endings"; }],
    [/^«(.+)»$/, function (m) { return "“" + T(m[1]) + "”"; }],
    [/^(\d+)$/, null]
  ];
  function dev(s) { return (s || "").replace(/ из /g, " of ").replace(/смертей/g, "deaths").replace(/игроков/g, "players"); }

  var cache = Object.create(null);
  function tr(s) {
    if (!CYR.test(s)) return s;
    if (s in cache) return cache[s];
    var out = null;
    if (Object.prototype.hasOwnProperty.call(EXACT, s)) out = EXACT[s];
    for (var i = 0; out == null && i < PAT.length; i++) {
      var m = PAT[i][0].exec(s);
      if (m && PAT[i][1]) { var r = PAT[i][1](m); if (r && !CYR.test(r)) out = r; }
    }
    if (out == null && s.indexOf(" · ") > 0) { // составная строка: по частям
      var parts = s.split(" · ").map(tr);
      if (parts.every(function (p) { return p != null; })) out = parts.join(" · ");
    }
    cache[s] = out;
    return out;
  }
  function T(s) { var r = tr(s); return r == null ? s : r; }

  // ---------- целые блоки прозы из index.html
  var HTML = {
    "#askstats .ask-wrap": '<p class="mono kicker">Before we start</p><h2>May I keep count?</h2>' +
      '<p class="ilead">I have one favor to ask. Please let the game collect anonymous statistics.</p>' +
      '<p>I\'m making this game on my own, and I really need to know where players get stuck, which deaths they find most often, and at what point they give up. Without that I\'m editing blind.</p>' +
      '<p>No personal data: no name, no email, no contacts. The game only sends a random number and markers like "reached graduation" or "died on the bridge." The Yandex Metrica counter sees the usual technical details of a visit, such as your device and browser type.</p>' +
      '<p>In return you\'ll see how many players found the same death as you, and how many made the same choice.</p>' +
      '<p class="dim tiny">If you change your mind, the menu has an "analytics: on/off" button. Details are under "About &amp; help."</p>' +
      '<div class="ask-btns"><button id="ask-yes" class="choice main-cta"><span class="cta-l">Allow</span></button><button id="ask-no" class="choice main-cta ghost-choice"><span class="cta-l">Not now</span></button></div>',
    "#intro .intro-wrap": '<div class="islide" data-k="0">' +
      '<p class="mono kicker">Princeton · 1957</p>' +
      '<p class="ilead">Hugh Everett is a twenty-six-year-old graduate student, and he asks a question physicists have been brushing aside for thirty years.</p>' +
      '<p>Quantum mechanics says that while nobody is looking at a particle, it is in every possible state at once. The textbooks added a rule to this: when you observe it, everything extra disappears and one outcome is left. Where that rule comes from, nobody could explain.</p>' +
      '<p>Everett simply threw it out. Then nothing disappears. At every such event the world splits into branches, and in each branch there is an observer who is sure there was only one outcome. You branch too. You just don\'t notice.</p>' +
      '<p>Niels Bohr rejected the idea, and Everett left physics. But his "many-worlds interpretation" outlived him, and today it is one of the leading accounts of how the world works.</p>' +
      '<p class="mono kicker ikick2">Quantum immortality</p>' +
      '<p class="ilead">If Everett is right, death has a strange loophole.</p>' +
      '<p>Imagine an experiment that kills you with a probability of one in two. The world splits. In one branch you are gone, and there is nobody left to notice. In the other you are alive and see that you survived. Repeat the experiment ten times. For everyone else you are almost certainly dead. From the inside, you always end up where you made it.</p>' +
      '<p>Hans Moravec and Max Tegmark discussed this thought experiment. Tegmark himself explained why it most likely doesn\'t work in real life: people don\'t die with a click, they die gradually. So don\'t try it on yourself.</p>' +
      '<p class="ilead">In this game, it works.</p></div>',
    ".title-head h1": TITLE_HTML,
    "#title .warn": '<summary><span class="age mono">16+</span> Heavy themes: death, suicide, war. If you\'re struggling, <button class="link" id="warn-help">helplines</button>. <span class="warn-more">more</span></summary>' +
      '<p>The game contains death, including the death of a child, suicidal thoughts, mental illness and refusing treatment, gambling with a deadly outcome, mine disasters, and a fictional war. If you\'re having a hard time right now, the "About &amp; help" section lists phone numbers where someone will answer.</p>',
    "#howto .znanie": '<p class="mono kicker">Science and fiction</p><h2>What this game is about</h2>' +
      '<p class="lead">Andrei Samokhin was born in Kemerovo, in the Kuzbass coal country of Siberia, in 1989. In the summer of 1996 he drowned in Black Backwater on the Tom River, and four minutes and twelve seconds later he was breathing again. Since then he has died more often than it seems, and every time he stays alive. The game explains this with one real idea from physics and one invented one.</p>' +
      '<p class="tiny"><button id="btn-intro-again" class="link">reread the introduction</button></p>' +
      '<h3>Hugh Everett and many worlds</h3>' +
      '<p>Quantum mechanics has an awkward spot. While nobody measures a particle, the equations describe it as a mixture of all its possible states at once: it is here and there. But when it is measured, we always see one outcome. How does the mixture turn into one result? Niels Bohr\'s Copenhagen school answered: on observation, the wave function "collapses." Why, and at what moment, nobody explained. The rule was simply attached to the theory.</p>' +
      '<p>In 1957 Hugh Everett, a twenty-six-year-old graduate student at Princeton, proposed throwing that rule out and trusting the equations all the way. Then nothing collapses. The measuring device, the lab and the physicist himself obey quantum mechanics too, and they also end up in the mixture: in one part of it the device read "left" and the physicist sees that, in another it read "right" and another physicist sees that. Both parts go on living and never meet again. To each version of the observer, it seems there was one outcome, and a random one.</p>' +
      '<p>Everett\'s adviser, John Wheeler, valued the idea but made him rewrite his dissertation more cautiously so as not to anger Bohr. It didn\'t help: in 1959 Everett went to Copenhagen, and Bohr and his students rejected the idea. Everett left science, spent years modeling nuclear war scenarios for the Pentagon, and died in 1982, at fifty-one. The physicist Bryce DeWitt picked up his idea. In the 1970s he named it the "many-worlds interpretation," and it became famous. Today it is one of the main versions of what quantum mechanics really says. Many physicists accept it, many don\'t, and so far no experiment can tell who is right.</p>' +
      '<figure class="diagram"><svg viewBox="0 0 320 170" role="img" aria-label="Diagram: a life branches; there is no observer in the branches where he dies, so he always ends up in a living branch">' +
      '<g fill="none" stroke-width="2" stroke-linecap="round"><path d="M20 85 H90" class="d-live"/><path d="M90 85 C120 85 120 40 150 40" class="d-dead"/><path d="M90 85 C120 85 120 125 150 125" class="d-live"/><path d="M150 125 C180 125 180 95 210 95" class="d-live"/><path d="M150 125 C180 125 180 155 210 155" class="d-dead"/><path d="M210 95 C240 95 240 70 270 70" class="d-dead"/><path d="M210 95 C240 95 240 115 300 115" class="d-live"/></g>' +
      '<g class="d-cross" font-size="16" text-anchor="middle"><text x="158" y="45">✝</text><text x="218" y="160">✝</text><text x="278" y="75">✝</text></g><circle cx="20" cy="85" r="4" class="d-dot"/><circle cx="300" cy="115" r="4" class="d-dot"/>' +
      '<text x="20" y="108" class="d-label" text-anchor="middle">1996</text><text x="300" y="138" class="d-label" text-anchor="middle">2061</text></svg>' +
      '<figcaption>Every fork splits the world. Where I died, I\'m no longer there, and nobody is left to notice. That\'s why, from the inside, I always end up in a living branch.</figcaption></figure>' +
      '<h3>Quantum immortality</h3>' +
      '<p>Everett\'s idea leads to a grim loophole. It is called quantum suicide and quantum immortality; in the 1980s and 1990s the roboticist Hans Moravec and the physicist Max Tegmark discussed it. Imagine an experiment with a fifty percent chance of killing you. In one branch you\'re gone, and you have nothing left to notice it with. In the other you\'re alive and see that you survived. Repeat it again and again, and from the inside you will always end up where you\'re alive. For everyone else, you almost certainly died long ago.</p>' +
      '<h3>Why you shouldn\'t test it on yourself</h3>' +
      '<p>Tegmark himself found where the theory breaks. Death is almost never an instant click: a person fades gradually, and there is no clean fork between "alive" and "dead." And the brain is warm and wet; quantum effects die out in it within trillionths of a second. So in our world there is most likely no quantum immortality. In the game, there is.</p>' +
      '<h3>Where the science ends</h3>' +
      '<p>Andrei has something in his head that other people don\'t: a little island where quantum effects don\'t die out. Where it came from, you\'ll find out yourself; that\'s part of the story. Because of it, Andrei\'s decisions truly split the world, and when one of his versions dies, its memory flows into the one that survived. This is fiction. It is inspired by the controversial hypothesis of Roger Penrose and Stuart Hameroff about quantum processes in neurons.</p>' +
      '<h3>How it works in the game</h3><ul class="rules">' +
      '<li><b>Death doesn\'t end the game.</b> You live through it and wake up at the point of choice, remembering everything.</li>' +
      '<li><b>The rewind.</b> How far back you can go depends on how strong the gift is. At first, only one step. Sometimes the real mistake was made earlier, and you still have to reach it.</li>' +
      '<li><b>The Choir.</b> The notebook of deaths: everyone you were who never came back. The Choir remembers them in later lives too, and sometimes that opens new roads.</li>' +
      '<li><b>The Drift.</b> If you bend fate to suit yourself too often, the world starts changing in small ways. Watch the details.</li>' +
      '<li><b>No chance.</b> Everything that happens follows from your decisions and from who you\'ve become.</li>' +
      '<li><b>No numbers.</b> The "Me" screen has only words: who you\'ve become, not how many points you\'ve scored.</li>' +
      '<li><b>My Life</b> is a map of every fork: what you\'ve lived is visible, the rest is in the fog.</li></ul>',
    "#about": '<button class="close ghost">×</button><h2>About &amp; help</h2>' +
      '<p>This is a story about one ordinary life in which you can\'t die. Death in the game is neither a punishment nor advice. It is the memory of those who didn\'t come back, and of those who waited for them.</p>' +
      '<p>If you\'re feeling bad right now and want to talk to someone: <b>findahelpline.com</b> lists free, confidential helplines in most countries. In the US, call or text <b>988</b>. In the UK and Ireland, Samaritans: <b>116 123</b>. In Russia: <b>8-800-333-44-34</b> (adults) and <b>8-800-2000-122</b> (children and teens), both free. Emergency services: <b>112</b> (<b>911</b> in North America).</p>' +
      '<p>The voices, the gift and the rewinds in the game are fiction. In real life, don\'t stop taking medication without a doctor.</p>' +
      '<p>All characters, mines, organizations, Orpheus, Second Chance, the Wager, and all events after 2026 are fictional. Any resemblance to real people, companies or states is coincidental.</p>' +
      '<p id="privacy-note" class="tiny">The game doesn\'t ask for a name, an email or registration. Progress is stored only in your browser and in a file you save yourself. Statistics are turned on only if you allow them. Then the game sends our server (Supabase) a random number with no name or email, plus markers: which deaths, endings and choices you\'ve had, and which scene you\'re in now. That\'s where shared numbers like "312 of 1,840 players got this death" come from. Yandex Metrica receives anonymized visit data: a cookie ID, IP address, device and browser type, and which chapters and endings are open. This helps me see where players give up. Other players\' shared numbers are visible without permission. You can turn this off with the "analytics" button in the menu or by clearing the site\'s data.</p>',
    "#credits .cr-in": '<p class="cr-kick mono">28.07.2061 · 04:12 · Kemerovo</p><h1 class="cr-title"><span>Black</span><br>Backwater</h1>' +
      '<p class="cr-sub">A text game about quantum immortality</p>' +
      '<h3>Idea</h3><p>Andrei Samokhin drowns at seven and survives.<br>He inherited quantum immortality<br>from his physicist grandfather<br>by way of his coal-miner father.<br>One life splits into nine roads.</p>' +
      '<h3>Author</h3><p class="cr-name">Basker</p><p>The idea, the world, the plot and the characters are his.<br>So are the canon and every decision.</p>' +
      '<h3>Text</h3><p>Basker wrote the script and the prose with an AI co-author.<br>He read every single scene<br>and left no mistake uncorrected.</p>' +
      '<h3>English version</h3><p>Adapted from the Russian with an AI translator<br>and reviewed by an AI critic, scene by scene.</p>' +
      '<h3>Engine</h3><p>My Life, Paths and the Choir Notebook<br>run on an engine built by an AI assistant.<br>The story checks are its work too.<br>The author gave it its tasks, point by point.</p>' +
      '<h3>Illustrations</h3><p>The pictures were drawn by a neural network<br>from the author\'s descriptions.<br>He chose them by hand, one at a time.</p>' +
      '<h3>Music</h3><p class="cr-name">Basker</p><p>The music grew out of three of his own tracks.<br>A neural network only rearranged them<br>for the hero\'s different lives.</p>' +
      '<h3>Numbers</h3><p>The game has 163 scenes and 26 endings.<br>You can die in it 79 different ways.<br>No dice. Everything is "if, then, else."</p>' +
      '<h3>Physics</h3><p>Hugh Everett: the many-worlds interpretation, 1957.<br>Hans Moravec and Max Tegmark described<br>quantum suicide and its flip side, immortality.</p><p class="cr-small">The physics here is fiction.<br>The scientists are not responsible for this story.</p>' +
      '<h3>Fonts</h3><p class="cr-small">PT Serif and PT Mono by ParaType.<br>Marck Script by Denis Masharov.<br>SIL Open Font License.</p>' +
      '<h3>Fiction</h3><p class="cr-small">All characters, mines and organizations are invented,<br>as are the events after 2026.<br>Only the Tom is real, and the spoil heaps,<br>and the smell in the stairwell when Dad came home from his shift.</p>' +
      '<p class="cr-end">Thank you for reading to this line.</p><p class="cr-hand">Synchronize watches.</p><p class="cr-kick mono">© 2026 Basker</p>'
  };

  // ---------- проход по DOM
  var ATTR = ["aria-label", "title", "placeholder", "alt"];
  var MISSING = window.QQ_I18N_MISSING = Object.create(null);
  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|CODE)$/;
  function inDev(el) { return el && el.closest && el.closest(".dev-panel, #dev-menu, .dbg, .devcap, .dv-path, #debug, #lore"); }
  function doText(node) {
    var v = node.nodeValue;
    if (!v || !CYR.test(v)) return;
    var p = node.parentNode;
    if (p && (SKIP.test(p.nodeName) || inDev(p))) return;
    var s = v.trim(), r = tr(s);
    if (r != null) { if (r !== s) node.nodeValue = v.replace(s, r); }
    else MISSING[s] = (MISSING[s] || 0) + 1;
  }
  function doAttrs(el) {
    if (!el.getAttribute || inDev(el)) return;
    for (var i = 0; i < ATTR.length; i++) {
      var a = el.getAttribute(ATTR[i]);
      if (a && CYR.test(a)) { var r = tr(a.trim()); if (r != null) el.setAttribute(ATTR[i], r); else MISSING[a] = (MISSING[a] || 0) + 1; }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doAttrs(root);
    var w = document.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */, null), x;
    while ((x = w.nextNode())) { if (x.nodeType === 3) doText(x); else doAttrs(x); }
  }
  for (var sel in HTML) { var el = document.querySelector(sel); if (el) el.innerHTML = HTML[sel]; }
  document.title = TITLE;
  // DLC-2 «Сорок первая строка» в английскую версию пока не входит (автор, 26.11) — в английском меню его нет
  var st = document.createElement("style"); st.textContent = "#btn-dlc2{display:none!important}"; document.head.appendChild(st);
  walk(document.body);
  var busy = false;
  new MutationObserver(function (list) {
    if (busy) return;
    busy = true;
    try {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "childList") for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        else if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doAttrs(m.target);
      }
    } finally { busy = false; }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });

  window.QQ_T = T;
  window.QQ_I18N = { tr: tr, T: T, title: TITLE, exact: EXACT };
})();
