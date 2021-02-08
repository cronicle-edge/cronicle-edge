// Cronicle Web App
// Author: Joseph Huckaby
// Copyright (c) 2015 Joseph Huckaby and PixlCore.com

if (!window.app) throw new Error("App Framework is not present.");

app.extend({
	
	name: '',
	preload_images: ['loading.gif'],
	activeJobs: {},
	eventQueue: {},
	state: null,
	plain_text_post: true,
	clock_visible: false,
	scroll_time_visible: false,
	default_prefs: {
		schedule_group_by: 'category'
	},

	fa_icons: {
		"f2b9": "fa-address-book",
		"f2ba": "fa-address-book-o",
		"f2bb": "fa-address-card",
		"f2bc": "fa-address-card-o",
		"f042": "fa-adjust",
		"f170": "fa-adn",
		"f037": "fa-align-center",
		"f039": "fa-align-justify",
		"f036": "fa-align-left",
		"f038": "fa-align-right",
		"f270": "fa-amazon",
		"f0f9": "fa-ambulance",
		"f2a3": "fa-american-sign-language-interpreting",
		"f13d": "fa-anchor",
		"f17b": "fa-android",
		"f209": "fa-angellist",
		"f103": "fa-angle-double-down",
		"f100": "fa-angle-double-left",
		"f101": "fa-angle-double-right",
		"f102": "fa-angle-double-up",
		"f107": "fa-angle-down",
		"f104": "fa-angle-left",
		"f105": "fa-angle-right",
		"f106": "fa-angle-up",
		"f179": "fa-apple",
		"f187": "fa-archive",
		"f1fe": "fa-area-chart",
		"f0ab": "fa-arrow-circle-down",
		"f0a8": "fa-arrow-circle-left",
		"f01a": "fa-arrow-circle-o-down",
		"f190": "fa-arrow-circle-o-left",
		"f18e": "fa-arrow-circle-o-right",
		"f01b": "fa-arrow-circle-o-up",
		"f0a9": "fa-arrow-circle-right",
		"f0aa": "fa-arrow-circle-up",
		"f063": "fa-arrow-down",
		"f060": "fa-arrow-left",
		"f061": "fa-arrow-right",
		"f047": "fa-arrows",
		"f0b2": "fa-arrows-alt",
		"f07e": "fa-arrows-h",
		"f07d": "fa-arrows-v",
		"f062": "fa-arrow-up",
		"f2a2": "fa-assistive-listening-systems",
		"f069": "fa-asterisk",
		"f1fa": "fa-at",
		"f29e": "fa-audio-description",
		"f1b9": "fa-automobile",
		"f04a": "fa-backward",
		"f24e": "fa-balance-scale",
		"f05e": "fa-ban",
		"f2d5": "fa-bandcamp",
		"f19c": "fa-bank",
		"f080": "fa-bar-chart",
		"f02a": "fa-barcode",
		"f0c9": "fa-bars",
		"f2cd": "fa-bath",
		"f240": "fa-battery",
		"f244": "fa-battery-0",
		"f243": "fa-battery-1",
		"f242": "fa-battery-2",
		"f241": "fa-battery-3",
		"f236": "fa-bed",
		"f0fc": "fa-beer",
		"f1b4": "fa-behance",
		"f1b5": "fa-behance-square",
		"f0f3": "fa-bell",
		"f0a2": "fa-bell-o",
		"f1f6": "fa-bell-slash",
		"f1f7": "fa-bell-slash-o",
		"f206": "fa-bicycle",
		"f1e5": "fa-binoculars",
		"f1fd": "fa-birthday-cake",
		"f171": "fa-bitbucket",
		"f172": "fa-bitbucket-square",
		"f15a": "fa-bitcoin",
		"f27e": "fa-black-tie",
		"f29d": "fa-blind",
		"f293": "fa-bluetooth",
		"f294": "fa-bluetooth-b",
		"f032": "fa-bold",
		"f0e7": "fa-bolt",
		"f1e2": "fa-bomb",
		"f02d": "fa-book",
		"f02e": "fa-bookmark",
		"f097": "fa-bookmark-o",
		"f2a1": "fa-braille",
		"f0b1": "fa-briefcase",
		"f188": "fa-bug",
		"f1ad": "fa-building",
		"f0f7": "fa-building-o",
		"f0a1": "fa-bullhorn",
		"f140": "fa-bullseye",
		"f207": "fa-bus",
		"f20d": "fa-buysellads",
		"f1ba": "fa-cab",
		"f1ec": "fa-calculator",
		"f073": "fa-calendar",
		"f274": "fa-calendar-check-o",
		"f272": "fa-calendar-minus-o",
		"f133": "fa-calendar-o",
		"f271": "fa-calendar-plus-o",
		"f273": "fa-calendar-times-o",
		"f030": "fa-camera",
		"f083": "fa-camera-retro",
		"f0d7": "fa-caret-down",
		"f0d9": "fa-caret-left",
		"f0da": "fa-caret-right",
		"f150": "fa-caret-square-o-down",
		"f191": "fa-caret-square-o-left",
		"f152": "fa-caret-square-o-right",
		"f151": "fa-caret-square-o-up",
		"f0d8": "fa-caret-up",
		"f218": "fa-cart-arrow-down",
		"f217": "fa-cart-plus",
		"f20a": "fa-cc",
		"f1f3": "fa-cc-amex",
		"f24c": "fa-cc-diners-club",
		"f1f2": "fa-cc-discover",
		"f24b": "fa-cc-jcb",
		"f1f1": "fa-cc-mastercard",
		"f1f4": "fa-cc-paypal",
		"f1f5": "fa-cc-stripe",
		"f1f0": "fa-cc-visa",
		"f0a3": "fa-certificate",
		"f0c1": "fa-chain",
		"f127": "fa-chain-broken",
		"f00c": "fa-check",
		"f058": "fa-check-circle",
		"f05d": "fa-check-circle-o",
		"f14a": "fa-check-square",
		"f046": "fa-check-square-o",
		"f13a": "fa-chevron-circle-down",
		"f137": "fa-chevron-circle-left",
		"f138": "fa-chevron-circle-right",
		"f139": "fa-chevron-circle-up",
		"f078": "fa-chevron-down",
		"f053": "fa-chevron-left",
		"f054": "fa-chevron-right",
		"f077": "fa-chevron-up",
		"f1ae": "fa-child",
		"f268": "fa-chrome",
		"f111": "fa-circle",
		"f10c": "fa-circle-o",
		"f1ce": "fa-circle-o-notch",
		"f1db": "fa-circle-thin",
		"f0ea": "fa-clipboard",
		"f017": "fa-clock-o",
		"f24d": "fa-clone",
		"f00d": "fa-close",
		"f0c2": "fa-cloud",
		"f0ed": "fa-cloud-download",
		"f0ee": "fa-cloud-upload",
		"f157": "fa-cny",
		"f121": "fa-code",
		"f126": "fa-code-fork",
		"f1cb": "fa-codepen",
		"f284": "fa-codiepie",
		"f0f4": "fa-coffee",
		"f013": "fa-cog",
		"f085": "fa-cogs",
		"f0db": "fa-columns",
		"f075": "fa-comment",
		"f27a": "fa-commenting",
		"f27b": "fa-commenting-o",
		"f0e5": "fa-comment-o",
		"f086": "fa-comments",
		"f0e6": "fa-comments-o",
		"f14e": "fa-compass",
		"f066": "fa-compress",
		"f20e": "fa-connectdevelop",
		"f26d": "fa-contao",
		"f0c5": "fa-copy",
		"f1f9": "fa-copyright",
		"f25e": "fa-creative-commons",
		"f09d": "fa-credit-card",
		"f283": "fa-credit-card-alt",
		"f125": "fa-crop",
		"f05b": "fa-crosshairs",
		"f13c": "fa-css3",
		"f1b2": "fa-cube",
		"f1b3": "fa-cubes",
		"f0c4": "fa-cut",
		"f0f5": "fa-cutlery",
		"f0e4": "fa-dashboard",
		"f210": "fa-dashcube",
		"f1c0": "fa-database",
		"f2a4": "fa-deaf",
		"f03b": "fa-dedent",
		"f1a5": "fa-delicious",
		"f108": "fa-desktop",
		"f1bd": "fa-deviantart",
		"f219": "fa-diamond",
		"f1a6": "fa-digg",
		"f155": "fa-dollar",
		"f192": "fa-dot-circle-o",
		"f019": "fa-download",
		"f17d": "fa-dribbble",
		"f2c2": "fa-drivers-license",
		"f2c3": "fa-drivers-license-o",
		"f16b": "fa-dropbox",
		"f1a9": "fa-drupal",
		"f282": "fa-edge",
		"f044": "fa-edit",
		"f2da": "fa-eercast",
		"f052": "fa-eject",
		"f141": "fa-ellipsis-h",
		"f142": "fa-ellipsis-v",
		"f1d1": "fa-empire",
		"f0e0": "fa-envelope",
		"f003": "fa-envelope-o",
		"f2b6": "fa-envelope-open",
		"f2b7": "fa-envelope-open-o",
		"f199": "fa-envelope-square",
		"f299": "fa-envira",
		"f12d": "fa-eraser",
		"f2d7": "fa-etsy",
		"f153": "fa-eur",
		"f0ec": "fa-exchange",
		"f12a": "fa-exclamation",
		"f06a": "fa-exclamation-circle",
		"f071": "fa-exclamation-triangle",
		"f065": "fa-expand",
		"f23e": "fa-expeditedssl",
		"f08e": "fa-external-link",
		"f14c": "fa-external-link-square",
		"f06e": "fa-eye",
		"f1fb": "fa-eyedropper",
		"f070": "fa-eye-slash",
		"f2b4": "fa-fa",
		"f09a": "fa-facebook",
		"f230": "fa-facebook-official",
		"f082": "fa-facebook-square",
		"f049": "fa-fast-backward",
		"f050": "fa-fast-forward",
		"f1ac": "fa-fax",
		"f09e": "fa-feed",
		"f182": "fa-female",
		"f0fb": "fa-fighter-jet",
		"f15b": "fa-file",
		"f1c6": "fa-file-archive-o",
		"f1c7": "fa-file-audio-o",
		"f1c9": "fa-file-code-o",
		"f1c3": "fa-file-excel-o",
		"f1c5": "fa-file-image-o",
		"f1c8": "fa-file-movie-o",
		"f016": "fa-file-o",
		"f1c1": "fa-file-pdf-o",
		"f1c4": "fa-file-powerpoint-o",
		"f15c": "fa-file-text",
		"f0f6": "fa-file-text-o",
		"f1c2": "fa-file-word-o",
		"f008": "fa-film",
		"f0b0": "fa-filter",
		"f06d": "fa-fire",
		"f134": "fa-fire-extinguisher",
		"f269": "fa-firefox",
		"f2b0": "fa-first-order",
		"f024": "fa-flag",
		"f11e": "fa-flag-checkered",
		"f11d": "fa-flag-o",
		"f0c3": "fa-flask",
		"f16e": "fa-flickr",
		"f0c7": "fa-floppy-o",
		"f07b": "fa-folder",
		"f114": "fa-folder-o",
		"f07c": "fa-folder-open",
		"f115": "fa-folder-open-o",
		"f031": "fa-font",
		"f280": "fa-fonticons",
		"f286": "fa-fort-awesome",
		"f211": "fa-forumbee",
		"f04e": "fa-forward",
		"f180": "fa-foursquare",
		"f2c5": "fa-free-code-camp",
		"f119": "fa-frown-o",
		"f1e3": "fa-futbol-o",
		"f11b": "fa-gamepad",
		"f0e3": "fa-gavel",
		"f154": "fa-gbp",
		"f22d": "fa-genderless",
		"f265": "fa-get-pocket",
		"f260": "fa-gg",
		"f261": "fa-gg-circle",
		"f06b": "fa-gift",
		"f1d3": "fa-git",
		"f09b": "fa-github",
		"f113": "fa-github-alt",
		"f092": "fa-github-square",
		"f296": "fa-gitlab",
		"f1d2": "fa-git-square",
		"f184": "fa-gittip",
		"f000": "fa-glass",
		"f2a5": "fa-glide",
		"f2a6": "fa-glide-g",
		"f0ac": "fa-globe",
		"f1a0": "fa-google",
		"f0d5": "fa-google-plus",
		"f2b3": "fa-google-plus-circle",
		"f0d4": "fa-google-plus-square",
		"f1ee": "fa-google-wallet",
		"f19d": "fa-graduation-cap",
		"f2d6": "fa-grav",
		"f0c0": "fa-group",
		"f1d4": "fa-hacker-news",
		"f255": "fa-hand-grab-o",
		"f258": "fa-hand-lizard-o",
		"f0a7": "fa-hand-o-down",
		"f0a5": "fa-hand-o-left",
		"f0a4": "fa-hand-o-right",
		"f0a6": "fa-hand-o-up",
		"f256": "fa-hand-paper-o",
		"f25b": "fa-hand-peace-o",
		"f25a": "fa-hand-pointer-o",
		"f257": "fa-hand-scissors-o",
		"f2b5": "fa-handshake-o",
		"f259": "fa-hand-spock-o",
		"f292": "fa-hashtag",
		"f0a0": "fa-hdd-o",
		"f1dc": "fa-header",
		"f025": "fa-headphones",
		"f004": "fa-heart",
		"f21e": "fa-heartbeat",
		"f08a": "fa-heart-o",
		"f1da": "fa-history",
		"f015": "fa-home",
		"f0f8": "fa-hospital-o",
		"f254": "fa-hourglass",
		"f251": "fa-hourglass-1",
		"f252": "fa-hourglass-2",
		"f253": "fa-hourglass-3",
		"f250": "fa-hourglass-o",
		"f27c": "fa-houzz",
		"f0fd": "fa-h-square",
		"f13b": "fa-html5",
		"f246": "fa-i-cursor",
		"f2c1": "fa-id-badge",
		"f20b": "fa-ils",
		"f03e": "fa-image",
		"f2d8": "fa-imdb",
		"f01c": "fa-inbox",
		"f03c": "fa-indent",
		"f275": "fa-industry",
		"f129": "fa-info",
		"f05a": "fa-info-circle",
		"f156": "fa-inr",
		"f16d": "fa-instagram",
		"f26b": "fa-internet-explorer",
		"f224": "fa-intersex",
		"f208": "fa-ioxhost",
		"f033": "fa-italic",
		"f1aa": "fa-joomla",
		"f1cc": "fa-jsfiddle",
		"f084": "fa-key",
		"f11c": "fa-keyboard-o",
		"f159": "fa-krw",
		"f1ab": "fa-language",
		"f109": "fa-laptop",
		"f202": "fa-lastfm",
		"f203": "fa-lastfm-square",
		"f06c": "fa-leaf",
		"f212": "fa-leanpub",
		"f094": "fa-lemon-o",
		"f149": "fa-level-down",
		"f148": "fa-level-up",
		"f1cd": "fa-life-bouy",
		"f0eb": "fa-lightbulb-o",
		"f201": "fa-line-chart",
		"f0e1": "fa-linkedin",
		"f08c": "fa-linkedin-square",
		"f2b8": "fa-linode",
		"f17c": "fa-linux",
		"f03a": "fa-list",
		"f022": "fa-list-alt",
		"f0cb": "fa-list-ol",
		"f0ca": "fa-list-ul",
		"f124": "fa-location-arrow",
		"f023": "fa-lock",
		"f175": "fa-long-arrow-down",
		"f177": "fa-long-arrow-left",
		"f178": "fa-long-arrow-right",
		"f176": "fa-long-arrow-up",
		"f2a8": "fa-low-vision",
		"f0d0": "fa-magic",
		"f076": "fa-magnet",
		"f064": "fa-mail-forward",
		"f112": "fa-mail-reply",
		"f122": "fa-mail-reply-all",
		"f183": "fa-male",
		"f279": "fa-map",
		"f041": "fa-map-marker",
		"f278": "fa-map-o",
		"f276": "fa-map-pin",
		"f277": "fa-map-signs",
		"f222": "fa-mars",
		"f227": "fa-mars-double",
		"f229": "fa-mars-stroke",
		"f22b": "fa-mars-stroke-h",
		"f22a": "fa-mars-stroke-v",
		"f136": "fa-maxcdn",
		"f20c": "fa-meanpath",
		"f23a": "fa-medium",
		"f0fa": "fa-medkit",
		"f2e0": "fa-meetup",
		"f11a": "fa-meh-o",
		"f223": "fa-mercury",
		"f2db": "fa-microchip",
		"f130": "fa-microphone",
		"f131": "fa-microphone-slash",
		"f068": "fa-minus",
		"f056": "fa-minus-circle",
		"f146": "fa-minus-square",
		"f147": "fa-minus-square-o",
		"f289": "fa-mixcloud",
		"f10b": "fa-mobile",
		"f285": "fa-modx",
		"f0d6": "fa-money",
		"f186": "fa-moon-o",
		"f21c": "fa-motorcycle",
		"f245": "fa-mouse-pointer",
		"f001": "fa-music",
		"f22c": "fa-neuter",
		"f1ea": "fa-newspaper-o",
		"f247": "fa-object-group",
		"f248": "fa-object-ungroup",
		"f263": "fa-odnoklassniki",
		"f264": "fa-odnoklassniki-square",
		"f23d": "fa-opencart",
		"f19b": "fa-openid",
		"f26a": "fa-opera",
		"f23c": "fa-optin-monster",
		"f18c": "fa-pagelines",
		"f1fc": "fa-paint-brush",
		"f0c6": "fa-paperclip",
		"f1d8": "fa-paper-plane",
		"f1d9": "fa-paper-plane-o",
		"f1dd": "fa-paragraph",
		"f04c": "fa-pause",
		"f28b": "fa-pause-circle",
		"f28c": "fa-pause-circle-o",
		"f1b0": "fa-paw",
		"f1ed": "fa-paypal",
		"f040": "fa-pencil",
		"f14b": "fa-pencil-square",
		"f295": "fa-percent",
		"f095": "fa-phone",
		"f098": "fa-phone-square",
		"f200": "fa-pie-chart",
		"f2ae": "fa-pied-piper",
		"f1a8": "fa-pied-piper-alt",
		"f1a7": "fa-pied-piper-pp",
		"f0d2": "fa-pinterest",
		"f231": "fa-pinterest-p",
		"f0d3": "fa-pinterest-square",
		"f072": "fa-plane",
		"f04b": "fa-play",
		"f144": "fa-play-circle",
		"f01d": "fa-play-circle-o",
		"f1e6": "fa-plug",
		"f067": "fa-plus",
		"f055": "fa-plus-circle",
		"f0fe": "fa-plus-square",
		"f196": "fa-plus-square-o",
		"f2ce": "fa-podcast",
		"f011": "fa-power-off",
		"f02f": "fa-print",
		"f288": "fa-product-hunt",
		"f12e": "fa-puzzle-piece",
		"f1d6": "fa-qq",
		"f029": "fa-qrcode",
		"f128": "fa-question",
		"f059": "fa-question-circle",
		"f29c": "fa-question-circle-o",
		"f2c4": "fa-quora",
		"f10d": "fa-quote-left",
		"f10e": "fa-quote-right",
		"f1d0": "fa-ra",
		"f074": "fa-random",
		"f2d9": "fa-ravelry",
		"f1b8": "fa-recycle",
		"f1a1": "fa-reddit",
		"f281": "fa-reddit-alien",
		"f1a2": "fa-reddit-square",
		"f021": "fa-refresh",
		"f25d": "fa-registered",
		"f18b": "fa-renren",
		"f01e": "fa-repeat",
		"f079": "fa-retweet",
		"f018": "fa-road",
		"f135": "fa-rocket",
		"f0e2": "fa-rotate-left",
		"f158": "fa-rouble",
		"f143": "fa-rss-square",
		"f267": "fa-safari",
		"f28a": "fa-scribd",
		"f002": "fa-search",
		"f010": "fa-search-minus",
		"f00e": "fa-search-plus",
		"f213": "fa-sellsy",
		"f233": "fa-server",
		"f1e0": "fa-share-alt",
		"f1e1": "fa-share-alt-square",
		"f14d": "fa-share-square",
		"f045": "fa-share-square-o",
		"f132": "fa-shield",
		"f21a": "fa-ship",
		"f214": "fa-shirtsinbulk",
		"f290": "fa-shopping-bag",
		"f291": "fa-shopping-basket",
		"f07a": "fa-shopping-cart",
		"f2cc": "fa-shower",
		"f012": "fa-signal",
		"f090": "fa-sign-in",
		"f2a7": "fa-sign-language",
		"f08b": "fa-sign-out",
		"f215": "fa-simplybuilt",
		"f0e8": "fa-sitemap",
		"f216": "fa-skyatlas",
		"f17e": "fa-skype",
		"f198": "fa-slack",
		"f1de": "fa-sliders",
		"f1e7": "fa-slideshare",
		"f118": "fa-smile-o",
		"f2ab": "fa-snapchat",
		"f2ac": "fa-snapchat-ghost",
		"f2ad": "fa-snapchat-square",
		"f2dc": "fa-snowflake-o",
		"f0dc": "fa-sort",
		"f15d": "fa-sort-alpha-asc",
		"f15e": "fa-sort-alpha-desc",
		"f160": "fa-sort-amount-asc",
		"f161": "fa-sort-amount-desc",
		"f0de": "fa-sort-asc",
		"f0dd": "fa-sort-desc",
		"f162": "fa-sort-numeric-asc",
		"f163": "fa-sort-numeric-desc",
		"f1be": "fa-soundcloud",
		"f197": "fa-space-shuttle",
		"f110": "fa-spinner",
		"f1b1": "fa-spoon",
		"f1bc": "fa-spotify",
		"f0c8": "fa-square",
		"f096": "fa-square-o",
		"f18d": "fa-stack-exchange",
		"f16c": "fa-stack-overflow",
		"f005": "fa-star",
		"f089": "fa-star-half",
		"f123": "fa-star-half-empty",
		"f006": "fa-star-o",
		"f1b6": "fa-steam",
		"f1b7": "fa-steam-square",
		"f048": "fa-step-backward",
		"f051": "fa-step-forward",
		"f0f1": "fa-stethoscope",
		"f249": "fa-sticky-note",
		"f24a": "fa-sticky-note-o",
		"f04d": "fa-stop",
		"f28d": "fa-stop-circle",
		"f28e": "fa-stop-circle-o",
		"f21d": "fa-street-view",
		"f0cc": "fa-strikethrough",
		"f1a4": "fa-stumbleupon",
		"f1a3": "fa-stumbleupon-circle",
		"f12c": "fa-subscript",
		"f239": "fa-subway",
		"f0f2": "fa-suitcase",
		"f185": "fa-sun-o",
		"f2dd": "fa-superpowers",
		"f12b": "fa-superscript",
		"f0ce": "fa-table",
		"f10a": "fa-tablet",
		"f02b": "fa-tag",
		"f02c": "fa-tags",
		"f0ae": "fa-tasks",
		"f2c6": "fa-telegram",
		"f26c": "fa-television",
		"f1d5": "fa-tencent-weibo",
		"f120": "fa-terminal",
		"f034": "fa-text-height",
		"f035": "fa-text-width",
		"f00a": "fa-th",
		"f2b2": "fa-themeisle",
		"f2c7": "fa-thermometer",
		"f2cb": "fa-thermometer-0",
		"f2ca": "fa-thermometer-1",
		"f2c9": "fa-thermometer-2",
		"f2c8": "fa-thermometer-3",
		"f009": "fa-th-large",
		"f00b": "fa-th-list",
		"f165": "fa-thumbs-down",
		"f088": "fa-thumbs-o-down",
		"f087": "fa-thumbs-o-up",
		"f164": "fa-thumbs-up",
		"f08d": "fa-thumb-tack",
		"f145": "fa-ticket",
		"f057": "fa-times-circle",
		"f05c": "fa-times-circle-o",
		"f2d3": "fa-times-rectangle",
		"f2d4": "fa-times-rectangle-o",
		"f043": "fa-tint",
		"f204": "fa-toggle-off",
		"f205": "fa-toggle-on",
		"f25c": "fa-trademark",
		"f238": "fa-train",
		"f225": "fa-transgender-alt",
		"f1f8": "fa-trash",
		"f014": "fa-trash-o",
		"f1bb": "fa-tree",
		"f181": "fa-trello",
		"f262": "fa-tripadvisor",
		"f091": "fa-trophy",
		"f0d1": "fa-truck",
		"f195": "fa-try",
		"f1e4": "fa-tty",
		"f173": "fa-tumblr",
		"f174": "fa-tumblr-square",
		"f1e8": "fa-twitch",
		"f099": "fa-twitter",
		"f081": "fa-twitter-square",
		"f0e9": "fa-umbrella",
		"f0cd": "fa-underline",
		"f29a": "fa-universal-access",
		"f09c": "fa-unlock",
		"f13e": "fa-unlock-alt",
		"f093": "fa-upload",
		"f287": "fa-usb",
		"f007": "fa-user",
		"f2bd": "fa-user-circle",
		"f2be": "fa-user-circle-o",
		"f0f0": "fa-user-md",
		"f2c0": "fa-user-o",
		"f234": "fa-user-plus",
		"f21b": "fa-user-secret",
		"f235": "fa-user-times",
		"f221": "fa-venus",
		"f226": "fa-venus-double",
		"f228": "fa-venus-mars",
		"f237": "fa-viacoin",
		"f2a9": "fa-viadeo",
		"f2aa": "fa-viadeo-square",
		"f03d": "fa-video-camera",
		"f27d": "fa-vimeo",
		"f194": "fa-vimeo-square",
		"f1ca": "fa-vine",
		"f189": "fa-vk",
		"f2a0": "fa-volume-control-phone",
		"f027": "fa-volume-down",
		"f026": "fa-volume-off",
		"f028": "fa-volume-up",
		"f1d7": "fa-wechat",
		"f18a": "fa-weibo",
		"f232": "fa-whatsapp",
		"f193": "fa-wheelchair",
		"f29b": "fa-wheelchair-alt",
		"f1eb": "fa-wifi",
		"f266": "fa-wikipedia-w",
		"f2d0": "fa-window-maximize",
		"f2d1": "fa-window-minimize",
		"f2d2": "fa-window-restore",
		"f17a": "fa-windows",
		"f19a": "fa-wordpress",
		"f297": "fa-wpbeginner",
		"f2de": "fa-wpexplorer",
		"f298": "fa-wpforms",
		"f0ad": "fa-wrench",
		"f168": "fa-xing",
		"f169": "fa-xing-square",
		"f19e": "fa-yahoo",
		"f23b": "fa-y-combinator",
		"f1e9": "fa-yelp",
		"f2b1": "fa-yoast",
		"f167": "fa-youtube",
		"f16a": "fa-youtube-play",
		"f166": "fa-youtube-square",
	},
	
	receiveConfig: function(resp) {
		// receive config from server
		if (resp.code) {
			app.showProgress( 1.0, "Waiting for manager server..." );
			setTimeout( function() { load_script( '/api/app/config?callback=app.receiveConfig' ); }, 1000 );
			return;
		}
		delete resp.code;
		window.config = resp.config;
		
		for (var key in resp) {
			this[key] = resp[key];
		}
		
		// allow visible app name to be changed in config
		this.name = config.name;
		$('#d_header_title').html( '<b>' + this.name + '</b>' );
		
		// hit the manager server directly from now on
		this.setmanagerHostname( resp.manager_hostname );
		
		this.config.Page = [
			{ ID: 'Home' },
			{ ID: 'Login' },
			{ ID: 'Schedule' },
			{ ID: 'History' },
			{ ID: 'JobDetails' },
			{ ID: 'MyAccount' },
			{ ID: 'Admin' }
		];
		this.config.DefaultPage = 'Home';
		
		// did we try to init and fail?  if so, try again now
		if (this.initReady) {
			this.hideProgress();
			delete this.initReady;
			this.init();
		}
	},
	
	init: function() {
		// initialize application
		if (this.abort) return; // fatal error, do not initialize app
		
		if (!this.config) {
			// must be in manager server wait loop
			this.initReady = true;
			return;
		}
		
		if (!this.servers) this.servers = {};
		this.server_groups = [];
		
		// timezone support
		this.tz = jstz.determine().name();
		this.zones = moment.tz.names();
		
		// preload a few essential images
		for (var idx = 0, len = this.preload_images.length; idx < len; idx++) {
			var filename = '' + this.preload_images[idx];
			var img = new Image();
			img.src = '/images/'+filename;
		}
		
		// populate prefs for first time user
		for (var key in this.default_prefs) {
			if (!(key in window.localStorage)) {
				window.localStorage[key] = this.default_prefs[key];
			}
		}
		
		// pop version into footer
		$('#d_footer_version').html( "Version " + this.version || 0 );
		
		// some css classing for browser-specific adjustments
		var ua = navigator.userAgent;
		if (ua.match(/Safari/) && !ua.match(/(Chrome|Opera)/)) {
			$('body').addClass('safari');
		}
		else if (ua.match(/Chrome/)) {
			$('body').addClass('chrome');
		}
		else if (ua.match(/Firefox/)) {
			$('body').addClass('firefox');
		}
		
		// follow scroll so we can fade in/out the scroll time widget
		window.addEventListener( "scroll", function() {
			app.checkScrollTime();
		}, false );
		app.checkScrollTime();
		
		this.page_manager = new PageManager( always_array(config.Page) );
		
		// this.setHeaderClock();
		this.socketConnect();
		
		// Nav.init();
	},
	
	updateHeaderInfo: function() {
		// update top-right display
		var html = '';
		html += '<div id="d_header_divider" class="right" style="margin-right:0;"></div>';
		html += '<div class="header_option logout right" onMouseUp="app.doUserLogout()"><i class="fa fa-power-off fa-lg">&nbsp;&nbsp;</i>Logout</div>';
		html += '<div id="d_header_divider" class="right"></div>';
		html += '<div id="d_header_user_bar" class="right" style="background-image:url(' + this.getUserAvatarURL( this.retina ? 64 : 32 ) + ')" onMouseUp="app.doMyAccount()">' + (this.user.full_name || app.username).replace(/\s+.+$/, '') + '</div>';
		$('#d_header_user_container').html( html );
	},
	
	doUserLogin: function(resp) {
		// user login, called from login page, or session recover
		// overriding this from base.js, so we can pass the session ID to the websocket
		delete resp.code;
		
		for (var key in resp) {
			this[key] = resp[key];
		}
		
		if (this.isCategoryLimited()  || this.isGroupLimited() ) {
			this.pruneSchedule();
			this.pruneCategories();
			this.pruneActiveJobs();
		}
		
		this.setPref('username', resp.username);
		this.setPref('session_id', resp.session_id);
		
		this.updateHeaderInfo();
		
		// update clock
		this.setHeaderClock( this.epoch );
		
		// show scheduler manager switch
		this.updatemanagerSwitch();
		if (this.hasPrivilege('state_update')) $('#d_tab_manager').addClass('active');
		
		// show admin tab if user is worthy
		if (this.isAdmin()) $('#tab_Admin').show();
		else $('#tab_Admin').hide();
		
		// authenticate websocket
		this.socket.emit( 'authenticate', { token: resp.session_id } );
	},
	
	doUserLogout: function(bad_cookie) {
		// log user out and redirect to login screen
		var self = this;
		
		if (!bad_cookie) {
			// user explicitly logging out
			this.showProgress(1.0, "Logging out...");
			this.setPref('username', '');
		}
		
		this.api.post( 'user/logout', {
			session_id: this.getPref('session_id')
		}, 
		function(resp, tx) {
			delete self.user;
			delete self.username;
			delete self.user_info;
			
			if (self.socket) self.socket.emit( 'logout', {} );
			
			self.setPref('session_id', '');
			
			$('#d_header_user_container').html( '' );
			$('#d_tab_manager').html( '' );
			
			$('div.header_clock_layer').fadeTo( 1000, 0 );
			$('#d_tab_time > span').html( '' );
			self.clock_visible = false;
			self.checkScrollTime();
			
			if (app.config.external_users) {
				// external user api
				Debug.trace("User session cookie was deleted, querying external user API");
				setTimeout( function() {
					if (bad_cookie) app.doExternalLogin(); 
					else app.doExternalLogout(); 
				}, 250 );
			}
			else {
				Debug.trace("User session cookie was deleted, redirecting to login page");
				self.hideProgress();
				Nav.go('Login');
			}
			
			setTimeout( function() {
				if (!app.config.external_users) {
					if (bad_cookie) self.showMessage('error', "Your session has expired.  Please log in again.");
					else self.showMessage('success', "You were logged out successfully.");
				}
				
				self.activeJobs = {};
				delete self.servers;
				delete self.schedule;
				delete self.categories;
				delete self.plugins;
				delete self.server_groups;
				delete self.epoch;
				
			}, 150 );
			
			$('#tab_Admin').hide();
		} );
	},
	
	doExternalLogin: function() {
		// login using external user management system
		// Force API to hit current page hostname vs. manager server, so login redirect URL reflects it
		app.api.post( '/api/user/external_login', { cookie: document.cookie }, function(resp) {
			if (resp.user) {
				Debug.trace("User Session Resume: " + resp.username + ": " + resp.session_id);
				app.hideProgress();
				app.doUserLogin( resp );
				Nav.refresh();
			}
			else if (resp.location) {
				Debug.trace("External User API requires redirect");
				app.showProgress(1.0, "Logging in...");
				setTimeout( function() { window.location = resp.location; }, 250 );
			}
			else app.doError(resp.description || "Unknown login error.");
		} );
	},
	
	doExternalLogout: function() {
		// redirect to external user management system for logout
		var url = app.config.external_user_api;
		url += (url.match(/\?/) ? '&' : '?') + 'logout=1';
		
		Debug.trace("External User API requires redirect");
		app.showProgress(1.0, "Logging out...");
		setTimeout( function() { window.location = url; }, 250 );
	},

	show_info: function(title) {
        // just display stuff and close dialog
		this.confirm_callback = this.hideDialog;

		let buttons_html = `
		  <center><table><tr>
		  <td><div class="button" style="width:100px; font-weight:normal;" onMouseUp="app.confirm_click(false)">OK</div></td>
		  </tr></table></center>
		`

		let html = `
		  <div class="dialog_title">${title}</div>
		  <div class="dialog_buttons">${buttons_html}</div>
		`
		Dialog.showAuto( "", html );
		// special mode for key capture
		Dialog.active = 'confirmation';
	},
	
	socketConnect: function() {
		// init socket.io client
		var self = this;
		
		var url = this.proto + this.managerHostname + ':' + this.port;
		if (!config.web_socket_use_hostnames && this.servers && this.servers[this.managerHostname] && this.servers[this.managerHostname].ip) {
			// use ip instead of hostname if available
			url = this.proto + this.servers[this.managerHostname].ip + ':' + this.port;
		}
		if (!config.web_direct_connect) {
			url = this.proto + location.host;
		}
		Debug.trace("Websocket Connect: " + url);
		
		if (this.socket) {
			Debug.trace("Destroying previous socket");
			this.socket.removeAllListeners();
			if (this.socket.connected) this.socket.disconnect();
			this.socket = null;
		}
		
		var socket = this.socket = io( url, {
			// forceNew: true,
			transports: config.socket_io_transports || ['websocket'],
			reconnection: false,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 2000,
			reconnectionAttempts: 9999,
			timeout: 3000
		} );
		
		socket.on('connect', function() {
			if (!Nav.inited) Nav.init();
			
			Debug.trace("socket.io connected successfully");
			// if (self.progress) self.hideProgress();
			
			// if we are already logged in, authenticate websocket now
			var session_id = app.getPref('session_id');
			if (session_id) socket.emit( 'authenticate', { token: session_id } );
		} );
		
		socket.on('connect_error', function(err) {
			Debug.trace("socket.io connect error: " + err);
		} );
		
		socket.on('connect_timeout', function(err) {
			Debug.trace("socket.io connect timeout");
		} );
		
		socket.on('reconnecting', function() {
			Debug.trace("socket.io reconnecting...");
			// self.showProgress( 0.5, "Reconnecting to server..." );
		} );
		
		socket.on('reconnect', function() {
			Debug.trace("socket.io reconnected successfully");
			// if (self.progress) self.hideProgress();
		} );
		
		socket.on('reconnect_failed', function() {
			Debug.trace("socket.io has given up -- we must refresh");
			location.reload();
		} );
		
		socket.on('disconnect', function() {
			// unexpected disconnection
			Debug.trace("socket.io disconnected unexpectedly");
		} );
		
		socket.on('status', function(data) {
			if (!data.manager) {
				// OMG we're not talking to manager anymore?
				self.recalculatemanager(data);
			}
			else {
				// connected to manager
				self.epoch = data.epoch;
				self.servers = data.servers;
				self.setHeaderClock( data.epoch );
				
				// update active jobs				
				self.updateActiveJobs( data );
				
				// notify current page
				var id = self.page_manager.current_page_id;
				var page = self.page_manager.find(id);
				if (page && page.onStatusUpdate) page.onStatusUpdate(data);
				
				// remove dialog if present
				if (self.waitingFormanager && self.progress) {
					self.hideProgress();
					delete self.waitingFormanager;
				}
			} // manager
		} );
		
		socket.on('update', function(data) {
			// receive data update (global list contents)
			var limited_user = self.isCategoryLimited() || self.isGroupLimited();
			
			for (var key in data) {
				self[key] = data[key];
				
				if (limited_user) {
					if (key == 'schedule') self.pruneSchedule();
					else if (key == 'categories') self.pruneCategories();
				}
				
				var id = self.page_manager.current_page_id;
				var page = self.page_manager.find(id);
				if (page && page.onDataUpdate) page.onDataUpdate(key, data[key]);
			}
			
			// update manager switch (once per minute)
			if (data.state) self.updatemanagerSwitch();
			
			// clear event autosave data if schedule was updated
			if (data.schedule) delete self.autosave_event;
		} );
		
		// --- Keep socket.io connected forever ---
		// This is the worst hack in history, but socket.io-client
		// is simply not behaving, and I have tried EVERYTHING ELSE.
		setInterval( function() {
			if (socket && !socket.connected) {
				Debug.trace("Forcing socket to reconnect");
				socket.connect();
			}
		}, 5000 );
	},
	
	updateActiveJobs: function(data) {
		// update active jobs
		var jobs = data.active_jobs;
		var changed = false;
		
		// hide silent jobs?
		// if(jobs) jobs = jobs.map(j=>!j.silent)
		
		// determine if jobs have been added or deleted
		for (var id in jobs) {
			// check for new jobs added
			if (!this.activeJobs[id]) changed = true;
		}
		for (var id in this.activeJobs) {
			// check for jobs completed
			if (!jobs[id]) changed = true;
		}
		
		this.activeJobs = jobs;
		if (this.isCategoryLimited()  || this.isGroupLimited() ) this.pruneActiveJobs();
		data.jobs_changed = changed;
	},
	
	pruneActiveJobs: function() {
		// remove active jobs that the user should not see, due to category/group privs
		if (!this.activeJobs) return;
		
		for (var id in this.activeJobs) {
			var job = this.activeJobs[id];
			if (!this.hasCategoryAccess(job.category) || !this.hasGroupAccess(job.target)) {
				delete this.activeJobs[id];
			}
		}
	},
	
	pruneSchedule: function() {
		// remove schedule items that the user should not see, due to category/group privs
		if (!this.schedule || !this.schedule.length) return;
		var new_items = [];
		
		for (var idx = 0, len = this.schedule.length; idx < len; idx++) {
			var item = this.schedule[idx];
			if (this.hasCategoryAccess(item.category) && this.hasGroupAccess(item.target)) {
				new_items.push(item);
			}
		}
		
		this.schedule = new_items;
	},
	
	pruneCategories: function() {
		// remove categories that the user should not see, due to category/group privs
		if (!this.categories || !this.categories.length) return;
		var new_items = [];
		
		for (var idx = 0, len = this.categories.length; idx < len; idx++) {
			var item = this.categories[idx];
			if (this.hasCategoryAccess(item.id)) new_items.push(item);
		}
		
		this.categories = new_items;
	},
	
	isCategoryLimited: function() {
		// return true if user is limited to specific categories, false otherwise
		if (this.isAdmin()) return false;
		return( app.user && app.user.privileges && app.user.privileges.cat_limit );
	},
	
	isGroupLimited: function() {
		// return true if user is limited to specific server groups, false otherwise
		if (this.isAdmin()) return false;
		return( app.user && app.user.privileges && app.user.privileges.grp_limit );
	},

	hasCategoryAccess: function(cat_id) {
		// check if user has access to specific category
		if (!app.user || !app.user.privileges) return false;
		if (app.user.privileges.admin) return true;
		if (!app.user.privileges.cat_limit) return true;
		
		var priv_id = 'cat_' + cat_id;
		return( !!app.user.privileges[priv_id] );
	},

	hasGroupAccess: function(grp_id) {
		// check if user has access to specific server group
		if (!app.user || !app.user.privileges) return false;
		if (app.user.privileges.admin) return true;
		if (!app.user.privileges.grp_limit) return true;

		var priv_id = 'grp_' + grp_id;
		var result = !!app.user.privileges[priv_id];
		if (result) return true;

		// make sure grp_id is a hostname from this point on
		if (find_object(app.server_groups, { id: grp_id })) return false;

		var groups = app.server_groups.filter( function(group) {
			return grp_id.match( group.regexp );
		} );

		// we just need one group to match, then the user has permission to target the server
		for (var idx = 0, len = groups.length; idx < len; idx++) {
			priv_id = 'grp_' + groups[idx].id;
			result = !!app.user.privileges[priv_id];
			if (result) return true;
		}
		return false;
	},
	
	hasPrivilege: function(priv_id) {
		// check if user has privilege
		if (!app.user || !app.user.privileges) return false;
		if (app.user.privileges.admin) return true;
		return( !!app.user.privileges[priv_id] );
	},
	
	recalculatemanager: function(data) {
		// Oops, we're connected to a worker!  manager must have been restarted.
		// If worker knows who is manager, switch now, otherwise go into wait loop
		var self = this;
		this.showProgress( 1.0, "Waiting for manager server..." );
		this.waitingFormanager = true;
		
		if (data.manager_hostname) {
			// reload browser which should connect to manager
			location.reload();
		}
	},
	
	setmanagerHostname: function(hostname) {
		// set new manager hostname, update stuff
		Debug.trace("New manager Hostname: " + hostname);
		this.managerHostname = hostname;
		
		if (config.web_direct_connect) {
			this.base_api_url = this.proto + this.managerHostname + ':' + this.port + config.base_api_uri;
			if (!config.web_socket_use_hostnames && this.servers && this.servers[this.managerHostname] && this.servers[this.managerHostname].ip) {
				// use ip instead of hostname if available
				this.base_api_url = this.proto + this.servers[this.managerHostname].ip + ':' + this.port + config.base_api_uri;
			}
		}
		else {
			this.base_api_url = this.proto + location.host + config.base_api_uri;
		}
		
		Debug.trace("API calls now going to: " + this.base_api_url);
	},
	
	setHeaderClock: function(when) {
		// move the header clock hands to the selected time
		
		if (!when) when = time_now();
		var dargs = get_date_args( when );
		
		// hour hand
		var hour = (((dargs.hour + (dargs.min / 60)) % 12) / 12) * 360;
		$('#d_header_clock_hour').css({
			transform: 'rotateZ('+hour+'deg)',
			'-webkit-transform': 'rotateZ('+hour+'deg)'
		});
		
		// minute hand
		var min = ((dargs.min + (dargs.sec / 60)) / 60) * 360;
		$('#d_header_clock_minute').css({
			transform: 'rotateZ('+min+'deg)',
			'-webkit-transform': 'rotateZ('+min+'deg)'
		});
		
		// second hand
		var sec = (dargs.sec / 60) * 360;
		$('#d_header_clock_second').css({
			transform: 'rotateZ('+sec+'deg)',
			'-webkit-transform': 'rotateZ('+sec+'deg)'
		});
		
		// show clock if needed
		if (!this.clock_visible) {
			this.clock_visible = true;
			$('div.header_clock_layer, #d_tab_time').fadeTo( 1000, 1.0 );
			this.checkScrollTime();
		}
		
		// date/time in tab bar
		// $('#d_tab_time, #d_scroll_time > span').html( get_nice_date_time( when, true, true ) );
		var num_active = num_keys( app.activeJobs || {} );
		var nice_active = commify(num_active) + ' ' + pluralize('Job', num_active);
		if (!num_active) nice_active = "Idle";
		
		$('#d_tab_time > span, #d_scroll_time > span').html(
			// get_nice_date_time( when, true, true ) + ' ' + 
			get_nice_time(when, true) + ' ' + 
			moment.tz( when * 1000, app.tz).format("z") + ' - ' + 
			nice_active
		);
	},
	
	updatemanagerSwitch: function() {
		// update manager switch display
		var html = '';
		if (this.hasPrivilege('state_update')) {
			html = '<i '+(this.state.enabled ? 'class="fa fa-check-square-o">' : 'class="fa fa-square-o">')+'</i>&nbsp;<b>Scheduler Enabled</b>';
		}
		else {
			if (this.state.enabled) html = '<i class="fa fa-check">&nbsp;</i><b>Scheduler Enabled</b>';
			else html = '<i class="fa fa-times">&nbsp;</i><b>Scheduler Disabled</b>';
		}
		
		$('#d_tab_manager')
			.css( 'color', this.state.enabled ? '#3f7ed5' : '#777' )
			.html( html );
	},
	
	togglemanagerSwitch: function() {
		// toggle manager scheduler switch on/off
		var self = this;
		var enabled = this.state.enabled ? 0 : 1;
		
		if (!this.hasPrivilege('state_update')) return;
		
		// $('#d_tab_manager > i').removeClass().addClass('fa fa-spin fa-spinner');
		
		app.api.post( 'app/update_manager_state', { enabled: enabled }, function(resp) {
			app.showMessage('success', "Scheduler has been " + (enabled ? 'enabled' : 'disabled') + ".");
			self.state.enabled = enabled;
			self.updatemanagerSwitch();
		} );
	},
	
	checkScrollTime: function() {
		// check page scroll, see if we need to fade in/out the scroll time widget
		var pos = get_scroll_xy();
		var y = pos.y;
		var min_y = 70;
		
		if ((y >= min_y) && this.clock_visible) {
			if (!this.scroll_time_visible) {
				// time to fade it in
				$('#d_scroll_time').stop().css('top', '0px').fadeTo( 1000, 1.0 );
				this.scroll_time_visible = true;
			}
		}
		else {
			if (this.scroll_time_visible) {
				// time to fade it out
				$('#d_scroll_time').stop().fadeTo( 500, 0, function() {
					$(this).css('top', '-30px');
				} );
				this.scroll_time_visible = false;
			}
		}
	},
	
	get_password_type: function() {
		// get user's pref for password field type, defaulting to config
		return this.getPref('password_type') || config.default_password_type || 'password';
	},
	
	get_password_toggle_html: function() {
		// get html for a password toggle control
		var text = (this.get_password_type() == 'password') ? 'Show' : 'Hide';
		return '<span class="link password_toggle" onMouseUp="app.toggle_password_field(this)">' + text + '</span>';
	},
	
	toggle_password_field: function(span) {
		// toggle password field visible / masked
		var $span = $(span);
		var $field = $span.prev();
		if ($field.attr('type') == 'password') {
			$field.attr('type', 'text');
			$span.html( 'Hide' );
			this.setPref('password_type', 'text');
		}
		else {
			$field.attr('type', 'password');
			$span.html( 'Show' );
			this.setPref('password_type', 'password');
		}
	},
	
	password_strengthify: function(sel) {
		// add password strength meter (text field should be wrapped by div)
		var $field = $(sel);
		var $div = $field.parent();
		
		var $cont = $('<div class="psi_container" title="Password strength indicator" onClick="window.open(\'https://tech.dropbox.com/2012/04/zxcvbn-realistic-password-strength-estimation/\')"></div>');
		$cont.css('width', $field[0].offsetWidth );
		$cont.html( '<div class="psi_bar"></div>' );
		$div.append( $cont );
		
		$field.keyup( function() {
			setTimeout( function() {
				app.update_password_strength($field, $cont);
			}, 1 );
		} );
		
		if (!window.zxcvbn) load_script('js/external/zxcvbn.js');
	},
	
	update_password_strength: function($field, $cont) {
		// update password strength indicator after keypress
		if (window.zxcvbn) {
			var password = $field.val();
			var result = zxcvbn( password );
			// Debug.trace("Password score: " + password + ": " + result.score);
			var $bar = $cont.find('div.psi_bar');
			$bar.removeClass('str0 str1 str2 str3 str4');
			if (password.length) $bar.addClass('str' + result.score);
			app.last_password_strength = result;
		}
	},
	
	get_password_warning: function() {
		// return string of text used for bad password dialog
		var est_length = app.last_password_strength.crack_time_display;
		if (est_length == 'instant') est_length = 'instantly';
		else est_length = 'in about ' + est_length;
		
		return "The password you entered is <b>insecure</b>, and could be easily compromised by hackers.  Our anaysis indicates that it could be cracked via brute force " + est_length + ". For more details see <a href=\"http://en.wikipedia.org/wiki/Password_strength\" target=\"_blank\">this article</a>.<br/><br/>Do you really want to use this password?";
	},
	
	get_color_checkbox_html: function(id, label, checked) {
		// get html for color label checkbox, with built-in handlers to toggle state
		if (checked === true) checked = "checked";
		else if (checked === false) checked = "";
		
		return '<span id="'+id+'" class="color_label checkbox ' + checked + '" onMouseUp="app.toggle_color_checkbox(this)"><i class="fa '+(checked.match(/\bchecked\b/) ? 'fa-check-square-o' : 'fa-square-o')+'">&nbsp;</i>'+label+'</span>';
	},
	
	toggle_color_checkbox: function(elem) {
		// toggle color checkbox state
		var $elem = $(elem);
		if ($elem.hasClass('checked')) {
			// uncheck
			$elem.removeClass('checked').find('i').removeClass('fa-check-square-o').addClass('fa-square-o');
		}
		else {
			// check
			$elem.addClass('checked').find('i').addClass('fa-check-square-o').removeClass('fa-square-o');
		}
	}
	
}); // app

function get_pretty_int_list(arr, ranges) {
	// compose int array to string using commas + spaces, and
	// the english "and" to group the final two elements.
	// also detect sequences and collapse those into dashed ranges
	if (!arr || !arr.length) return '';
	if (arr.length == 1) return arr[0].toString();
	arr = deep_copy_object(arr).sort( function(a, b) { return a - b; } );
	
	// check for ranges and collapse them
	if (ranges) {
		var groups = [];
		var group = [];
		for (var idx = 0, len = arr.length; idx < len; idx++) {
			var elem = arr[idx];
			if (!group.length || (elem == group[group.length - 1] + 1)) group.push(elem);
			else { groups.push(group); group = [elem]; }
		}
		if (group.length) groups.push(group);
		arr = [];
		for (var idx = 0, len = groups.length; idx < len; idx++) {
			var group = groups[idx];
			if (group.length == 1) arr.push( group[0] );
			else if (group.length == 2) {
				arr.push( group[0] );
				arr.push( group[1] );
			}
			else {
				arr.push( group[0] + ' - ' + group[group.length - 1] );
			}
		}
	} // ranges
	
	if (arr.length == 1) return arr[0].toString();
	return arr.slice(0, arr.length - 1).join(', ') + ' and ' + arr[ arr.length - 1 ];
}

function summarize_event_timing(timing, timezone, extra) {
	// summarize event timing into human-readable string
	if (!timing && extra) {
		return `<span title="${'Extra Ticks: ' + extra.toString().split(/[\,\;\|]/).filter(e => e).join(', ')}">On Demand +</span>`
	}
	if (!timing) { return "On demand" };
	
	// years
	var year_str = '';
	if (timing.years && timing.years.length) {
		year_str = get_pretty_int_list(timing.years, true);
	}
	
	// months
	var mon_str = '';
	if (timing.months && timing.months.length) {
		mon_str = get_pretty_int_list(timing.months, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return _months[ parseInt(m_g1) - 1 ][1];
		});
	}
	
	// days
	var mday_str = '';
	if (timing.days && timing.days.length) {
		mday_str = get_pretty_int_list(timing.days, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return m_g1 + _number_suffixes[ parseInt( m_g1.substring(m_g1.length - 1) ) ];
		});
	}
	
	// weekdays	
	var wday_str = '';
	if (timing.weekdays && timing.weekdays.length) {
		wday_str = get_pretty_int_list(timing.weekdays, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return _day_names[ parseInt(m_g1) ] + 's';
		});
		wday_str = wday_str.replace(/Mondays\s+\-\s+Fridays/, 'weekdays');
	}
	
	// hours
	var hour_str = '';
	if (timing.hours && timing.hours.length) {
		hour_str = get_pretty_int_list(timing.hours, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return _hour_names[ parseInt(m_g1) ];
		});
	}
	
	// minutes
	var min_str = '';
	if (timing.minutes && timing.minutes.length) {
		min_str = get_pretty_int_list(timing.minutes, false).replace(/(\d+)/g, function(m_all, m_g1) {
			return ':' + ((m_g1.length == 1) ? ('0'+m_g1) : m_g1);
		});
	}
	
	// construct final string
	var groups = [];
	var mday_compressed = false;
	
	if (year_str) {
		groups.push( 'in ' + year_str );
		if (mon_str) groups.push( mon_str );
	}
	else if (mon_str) {
		// compress single month + single day
		if (timing.months && timing.months.length == 1 && timing.days && timing.days.length == 1) {
			groups.push( 'on ' + mon_str + ' ' + mday_str );
			mday_compressed = true;
		}
		else {
			groups.push( 'in ' + mon_str );
		}
	}
	
	if (mday_str && !mday_compressed) {
		if (mon_str || wday_str) groups.push( 'on the ' + mday_str );
		else groups.push( 'monthly on the ' + mday_str );
	}
	if (wday_str) groups.push( 'on ' + wday_str );
	
	// compress single hour + single minute
	if (timing.hours && timing.hours.length == 1 && timing.minutes && timing.minutes.length == 1) {
		hour_str.match(/^(\d+)(\w+)$/);
		var hr = RegExp.$1;
		var ampm = RegExp.$2;
		var new_str = hr + min_str + ampm;
		
		if (mday_str || wday_str) groups.push( 'at ' + new_str );
		else groups.push( 'daily at ' + new_str );
	}
	else {
		var min_added = false;
		if (hour_str) {
			if (mday_str || wday_str) groups.push( 'at ' + hour_str );
			else groups.push( 'daily at ' + hour_str );
		}
		else {
			// check for repeating minute pattern
			if (timing.minutes && timing.minutes.length) {
				var interval = detect_num_interval( timing.minutes, 60 );
				if (interval) {
					var new_str = 'every ' + interval + ' minutes';
					if (timing.minutes[0] > 0) {
						var m_g1 = timing.minutes[0].toString();
						new_str += ' starting on the :' + ((m_g1.length == 1) ? ('0'+m_g1) : m_g1);
					}
					groups.push( new_str );
					min_added = true;
				}
			}
			
			if (!min_added) {
				if (min_str) groups.push( 'hourly' );
			}
		}
		
		if (!min_added) {
			if (min_str) groups.push( 'on the ' + min_str.replace(/\:00/, 'hour').replace(/\:30/, 'half-hour') );
			else groups.push( 'every minute' );
		}
	}
	
	var text = groups.join(', ');
	var output = text.substring(0, 1).toUpperCase() + text.substring(1, text.length);
	
	if (timezone && (timezone != app.tz)) {
		// get tz abbreviation
		output += ' (' + moment.tz.zone(timezone).abbr( (new Date()).getTime() ) + ')';
	}
	
	if(extra) {
		let xtitle = extra.toString().split(/[\,\;\|]/).filter(e=>e).join(', ')
		return `<span title="Extra Ticks: ${xtitle}">${output} +</span>`
	}
	
	return output
};

function detect_num_interval(arr, max) {
	// detect interval between array elements, return if found
	// all elements must have same interval between them
	if (arr.length < 2) return false;
	// if (arr[0] > 0) return false;
	
	var interval = arr[1] - arr[0];
	for (var idx = 1, len = arr.length; idx < len; idx++) {
		var temp = arr[idx] - arr[idx - 1];
		if (temp != interval) return false;
	}
	
	// if max is provided, final element + interval must equal max
	// if (max && (arr[arr.length - 1] + interval != max)) return false;
	if (max && ((arr[arr.length - 1] + interval) % max != arr[0])) return false;
	
	return interval;
};

// Crontab Parsing Tools
// by Joseph Huckaby, (c) 2015, MIT License

var cron_aliases = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
	
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6
};
var cron_alias_re = new RegExp("\\b(" + hash_keys_to_array(cron_aliases).join('|') + ")\\b", "g");

function parse_crontab_part(timing, raw, key, min, max, rand_seed) {
	// parse one crontab part, e.g. 1,2,3,5,20-25,30-35,59
	// can contain single number, and/or list and/or ranges and/or these things: */5 or 10-50/5
	if (raw == '*') { return; } // wildcard
	if (raw == 'h') {
		// unique value over accepted range, but locked to random seed
		// https://github.com/jhuckaby/Cronicle/issues/6
		raw = min + (parseInt( hex_md5(rand_seed), 16 ) % ((max - min) + 1));
		raw = '' + raw;
	}
	if (!raw.match(/^[\w\-\,\/\*]+$/)) { throw new Error("Invalid crontab format: " + raw); }
	var values = {};
	var bits = raw.split(/\,/);
	
	for (var idx = 0, len = bits.length; idx < len; idx++) {
		var bit = bits[idx];
		if (bit.match(/^\d+$/)) {
			// simple number, easy
			values[bit] = 1;
		}
		else if (bit.match(/^(\d+)\-(\d+)$/)) {
			// simple range, e.g. 25-30
			var start = parseInt( RegExp.$1 );
			var end = parseInt( RegExp.$2 );
			for (var idy = start; idy <= end; idy++) { values[idy] = 1; }
		}
		else if (bit.match(/^\*\/(\d+)$/)) {
			// simple step interval, e.g. */5
			var step = parseInt( RegExp.$1 );
			var start = min;
			var end = max;
			for (var idy = start; idy <= end; idy += step) { values[idy] = 1; }
		}
		else if (bit.match(/^(\d+)\-(\d+)\/(\d+)$/)) {
			// range step inverval, e.g. 1-31/5
			var start = parseInt( RegExp.$1 );
			var end = parseInt( RegExp.$2 );
			var step = parseInt( RegExp.$3 );
			for (var idy = start; idy <= end; idy += step) { values[idy] = 1; }
		}
		else {
			throw new Error("Invalid crontab format: " + bit + " (" + raw + ")");
		}
	}
	
	// min max
	var to_add = {};
	var to_del = {};
	for (var value in values) {
		value = parseInt( value );
		if (value < min) {
			to_del[value] = 1;
			to_add[min] = 1;
		}
		else if (value > max) {
			to_del[value] = 1;
			value -= min;
			value = value % ((max - min) + 1); // max is inclusive
			value += min;
			to_add[value] = 1;
		}
	}
	for (var value in to_del) delete values[value];
	for (var value in to_add) values[value] = 1;
	
	// convert to sorted array
	var list = hash_keys_to_array(values);
	for (var idx = 0, len = list.length; idx < len; idx++) {
		list[idx] = parseInt( list[idx] );
	}
	list = list.sort( function(a, b) { return a - b; } );
	if (list.length) timing[key] = list;
};

function parse_crontab(raw, rand_seed) {
	// parse standard crontab syntax, return timing object
	// e.g. 1,2,3,5,20-25,30-35,59 23 31 12 * *
	// optional 6th element == years
	if (!rand_seed) rand_seed = get_unique_id();
	var timing = {};
	
	// resolve all @shortcuts
	raw = trim(raw).toLowerCase();
	if (raw.match(/\@(yearly|annually)/)) raw = '0 0 1 1 *';
	else if (raw == '@monthly') raw = '0 0 1 * *';
	else if (raw == '@weekly') raw = '0 0 * * 0';
	else if (raw == '@daily') raw = '0 0 * * *';
	else if (raw == '@hourly') raw = '0 * * * *';
	
	// expand all month/wday aliases
	raw = raw.replace(cron_alias_re, function(m_all, m_g1) {
		return cron_aliases[m_g1];
	} );
	
	// at this point string should not contain any alpha characters or '@', except for 'h'
	if (raw.match(/([a-gi-z\@]+)/i)) throw new Error("Invalid crontab keyword: " + RegExp.$1);
	
	// split into parts
	var parts = raw.split(/\s+/);
	if (parts.length > 6) throw new Error("Invalid crontab format: " + parts.slice(6).join(' '));
	if (!parts[0].length) throw new Error("Invalid crontab format");
	
	// parse each part
	if ((parts.length > 0) && parts[0].length) parse_crontab_part( timing, parts[0], 'minutes', 0, 59, rand_seed );
	if ((parts.length > 1) && parts[1].length) parse_crontab_part( timing, parts[1], 'hours', 0, 23, rand_seed );
	if ((parts.length > 2) && parts[2].length) parse_crontab_part( timing, parts[2], 'days', 1, 31, rand_seed );
	if ((parts.length > 3) && parts[3].length) parse_crontab_part( timing, parts[3], 'months', 1, 12, rand_seed );
	if ((parts.length > 4) && parts[4].length) parse_crontab_part( timing, parts[4], 'weekdays', 0, 6, rand_seed );
	if ((parts.length > 5) && parts[5].length) parse_crontab_part( timing, parts[5], 'years', 1970, 3000, rand_seed );
	
	return timing;
};

// TAB handling code from http://www.webdeveloper.com/forum/showthread.php?t=32317
// Hacked to do my bidding - JH 2008-09-15
function setSelectionRange(input, selectionStart, selectionEnd) {
  if (input.setSelectionRange) {
    input.focus();
    input.setSelectionRange(selectionStart, selectionEnd);
  }
  else if (input.createTextRange) {
    var range = input.createTextRange();
    range.collapse(true);
    range.moveEnd('character', selectionEnd);
    range.moveStart('character', selectionStart);
    range.select();
  }
};

function replaceSelection (input, replaceString) {
	var oldScroll = input.scrollTop;
	if (input.setSelectionRange) {
		var selectionStart = input.selectionStart;
		var selectionEnd = input.selectionEnd;
		input.value = input.value.substring(0, selectionStart)+ replaceString + input.value.substring(selectionEnd);

		if (selectionStart != selectionEnd){ 
			setSelectionRange(input, selectionStart, selectionStart + 	replaceString.length);
		}else{
			setSelectionRange(input, selectionStart + replaceString.length, selectionStart + replaceString.length);
		}

	}else if (document.selection) {
		var range = document.selection.createRange();

		if (range.parentElement() == input) {
			var isCollapsed = range.text == '';
			range.text = replaceString;

			 if (!isCollapsed)  {
				range.moveStart('character', -replaceString.length);
				range.select();
			}
		}
	}
	input.scrollTop = oldScroll;
};

function catchTab(item,e){
	var c = e.which ? e.which : e.keyCode;

	if (c == 9){
		replaceSelection(item,String.fromCharCode(9));
		setTimeout("document.getElementById('"+item.id+"').focus();",0);	
		return false;
	}
};

function get_text_from_seconds_round_custom(sec, abbrev) {
	// convert raw seconds to human-readable relative time
	// round to nearest instead of floor, but allow one decimal point if under 10 units
	var neg = '';
	if (sec < 0) { sec =- sec; neg = '-'; }
	
	var text = abbrev ? "sec" : "second";
	var amt = sec;
	
	if (sec > 59) {
		var min = sec / 60;
		text = abbrev ? "min" : "minute"; 
		amt = min;
		
		if (min > 59) {
			var hour = min / 60;
			text = abbrev ? "hr" : "hour"; 
			amt = hour;
			
			if (hour > 23) {
				var day = hour / 24;
				text = "day"; 
				amt = day;
			} // hour>23
		} // min>59
	} // sec>59
	
	if (amt < 10) amt = Math.round(amt * 10) / 10;
	else amt = Math.round(amt);
	
	var text = "" + amt + " " + text;
	if ((amt != 1) && !abbrev) text += "s";
	
	return(neg + text);
};
