const Brief = {

    FIRST_RUN_PAGE_URL: 'chrome://brief/content/firstrun.xhtml',
    RELEASE_NOTES_URL_PREFIX: 'http://brief.mozdev.org/versions/',

    BRIEF_URL: 'chrome://brief/content/brief.xul',
    BRIEF_OPTIONS_URL: 'chrome://brief/content/options/options.xul',
    BRIEF_FAVICON_URL: 'chrome://brief/skin/brief-icon-16.png',

    get statusCounter() document.getElementById('brief-status-counter'),

    get toolbarbutton() document.getElementById('brief-button'),

    get prefs() {
        delete this.prefs;
        return this.prefs = Services.prefs.getBranch('extensions.brief.');
    },

    get storage() {
        let tempScope = {};
        Components.utils.import('resource://brief/Storage.jsm', tempScope);

        delete this.storage;
        return this.storage = tempScope.Storage;
    },

    get updateService() {
        let tempScope = {};
        Components.utils.import('resource://brief/FeedUpdateService.jsm', tempScope);

        delete this.updateService;
        return this.updateService = tempScope.FeedUpdateService;
    },

    get query() {
        let tempScope = {};
        Components.utils.import('resource://brief/Storage.jsm', tempScope);

        delete this.query;
        return this.query = tempScope.Query
    },

    get common() {
        let tempScope = {};
        Components.utils.import('resource://brief/common.jsm', tempScope);

        delete this.common;
        return this.common = tempScope;
    },

    get OPML() {
        let tempScope = {};
        Components.utils.import('resource://brief/opml.jsm', tempScope);

        delete this.OPML;
        return this.OPML = tempScope.OPML;
    },

    open: function Brief_open(aInCurrentTab) {
        let loading = gBrowser.webProgress.isLoadingDocument;
        let blank = isBlankPageURL(gBrowser.currentURI.spec);
        let briefTab = this.getBriefTab();

        if (briefTab)
            gBrowser.selectedTab = briefTab;
        else if (blank && !loading || aInCurrentTab)
            gBrowser.loadURI(this.BRIEF_URL, null, null);
        else
            gBrowser.loadOneTab(this.BRIEF_URL, { inBackground: false });
    },

    getBriefTab: function Brief_getBriefTab() {
        for (let tab of gBrowser.tabs) {
            if (gBrowser.getBrowserForTab(tab).currentURI.spec == this.BRIEF_URL)
                return tab;
        }

        return null;
    },

    // Returns Brief's content window if the tab is selected.
    get win() {
        return gBrowser.currentURI.spec == this.BRIEF_URL
               ? gBrowser.contentDocument.defaultView.wrappedJSObject
               : null;
    },

    toggleUnreadCounter: function Brief_toggleUnreadCounter() {
        let menuitem = document.getElementById('brief-show-unread-counter');
        let checked = menuitem.getAttribute('checked') == 'true';
        Brief.prefs.setBoolPref('showUnreadCounter', !checked);
    },

    showOptions: function cmd_showOptions() {
        let windows = Services.wm.getEnumerator(null);
        while (windows.hasMoreElements()) {
            let win = windows.getNext();
            if (win.document.documentURI == Brief.BRIEF_OPTIONS_URL) {
                win.focus();
                return;
            }
        }

        let features = 'chrome,titlebar,toolbar,centerscreen,';
        window.openDialog(Brief.BRIEF_OPTIONS_URL, 'Brief options', features);
    },

    onTabLoad: function Brief_onTabLoad(aEvent) {
        if (aEvent.target && aEvent.target.documentURI == Brief.BRIEF_URL)
            gBrowser.setIcon(Brief.getBriefTab(), Brief.BRIEF_FAVICON_URL);
    },

    onWindowLoad: function Brief_onWindowLoad(aEvent) {
        window.removeEventListener('load', arguments.callee, false);

        // Register Brief as a content handler for feeds. Can't do it in the
        // service component because the registrar doesn't work yet.
        const CONTENT_TYPE = 'application/vnd.mozilla.maybe.feed';
        const SUBSCRIBE_URL = 'brief://subscribe/%s';

        let wccs = Cc['@mozilla.org/embeddor.implemented/web-content-handler-registrar;1']
                   .getService(Ci.nsIWebContentConverterService);

        if (!wccs.getWebContentHandlerByURI(CONTENT_TYPE, SUBSCRIBE_URL))
            wccs.registerContentHandler(CONTENT_TYPE, SUBSCRIBE_URL, 'Brief', null);

        if (this.prefs.getBoolPref('firstRun')) {
            this.onFirstRun();
        }
        else {
            // If Brief has been updated, load the new version info page.
            AddonManager.getAddonByID('brief@mozdev.org', function(addon) {
                let prevVersion = this.prefs.getCharPref('lastVersion');

                if (Services.vc.compare(prevVersion, addon.version) < 0) {
                    let url = this.RELEASE_NOTES_URL_PREFIX + addon.version + '.html';
                    gBrowser.loadOneTab(url, { relatedToCurrent: false,
                                               inBackground: false });
                    this.prefs.setCharPref('lastVersion', addon.version);
                }
            }.bind(this))
        }

        if (this.toolbarbutton)
            this.initUnreadCounter();

        gBrowser.addEventListener('pageshow', this.onTabLoad, false);

        CustomizableUI.addListener({
            onCustomizeEnd: () => {
                this.initUnreadCounter();
                this.updateStatus();
            }
        });

        this.storage.ready.then(() => {
            this.storage.addObserver(this);
            this.updateStatus();
            Services.obs.addObserver(this.refreshUI, 'brief:invalidate-feedlist', false);
        })

        this.prefs.addObserver('', this.onPrefChanged, false);

        window.addEventListener('unload', this.onWindowUnload.bind(this), false);
    },

    onWindowUnload: function Brief_onWindowUnload(aEvent) {
        this.storage.removeObserver(this);
        this.prefs.removeObserver('', this.onPrefChanged);
        Services.obs.removeObserver(this.refreshUI, 'brief:invalidate-feedlist');
    },


    onPrefChanged: function Brief_onPrefChanged(aSubject, aTopic, aData) {
        if (aData == 'showUnreadCounter') {
            if (Brief.toolbarbutton)
                Brief.initUnreadCounter();

            if (newValue)
                Brief.storage.ready.then(Brief.updateStatus);
        }
    },


    onEntriesAdded: function(aEntryList) this.refreshUI(),

    onEntriesUpdated: function(aEntryList) this.refreshUI(),

    onEntriesMarkedRead: function(aEntryList, aState) this.refreshUI(),

    onEntriesDeleted: function(aEntryList, aState) this.refreshUI(),

    initUnreadCounter: function() {
        let showCounter = this.prefs.getBoolPref('showUnreadCounter');
        this.statusCounter.hidden = !showCounter;

        let menuitem = document.getElementById('brief-show-unread-counter');
        menuitem.setAttribute('checked', showCounter);
    },

    refreshUI: function Brief_refreshUI() {
        setTimeout(Brief.updateStatus.bind(Brief), 500);

        let tooltip = document.getElementById('brief-tooltip');
        if (tooltip.state == 'open' || tooltip.state == 'showing')
            Brief.constructTooltip();
    },

    updateStatus: function Brief_updateStatus() {
        if (!Brief.toolbarbutton || !Brief.prefs.getBoolPref('showUnreadCounter'))
            return;

        let query = new Brief.query({
            includeFeedsExcludedFromGlobalViews: false,
            deleted: Brief.storage.ENTRY_STATE_NORMAL,
            read: false
        })

        query.getEntryCount().then(unreadEntriesCount => {
            Brief.statusCounter.value = unreadEntriesCount;
            Brief.statusCounter.hidden = (unreadEntriesCount == 0);

            // Attribute to enable custom styling via userChrome.css.
            Brief.toolbarbutton.setAttribute('unread-entries', unreadEntriesCount);
        })
    },


    constructTooltip: function Brief_constructTooltip() {
        let label = document.getElementById('brief-tooltip-last-updated');
        let bundle = Services.strings.createBundle('chrome://brief/locale/brief.properties');

        let lastUpdateTime = this.prefs.getIntPref('update.lastUpdateTime') * 1000;
        let date = new Date(lastUpdateTime);
        let relativeDate = new this.common.RelativeDate(lastUpdateTime);

        let time, pluralForms, form;

        switch (true) {
            case relativeDate.deltaMinutes === 0:
                label.value = bundle.GetStringFromName('lastUpdated.rightNow');
                break;

            case relativeDate.deltaHours === 0:
                pluralForms = bundle.GetStringFromName('minute.pluralForms');
                form = this.common.getPluralForm(relativeDate.deltaMinutes, pluralForms);
                label.value = bundle.formatStringFromName('lastUpdated.ago', [form], 1)
                                    .replace('#number', relativeDate.deltaMinutes);
                break;

            case relativeDate.deltaHours <= 12:
                pluralForms = bundle.GetStringFromName('hour.pluralForms');
                form = this.common.getPluralForm(relativeDate.deltaHours, pluralForms);
                label.value = bundle.formatStringFromName('lastUpdated.ago', [form], 1)
                                    .replace('#number', relativeDate.deltaHours);
                break;

            case relativeDate.deltaDaySteps === 0:
                time = date.toLocaleFormat('%X').replace(/:\d\d$/, ' ');
                label.value = bundle.formatStringFromName('lastUpdated.today', [time], 1);
                break;

            case relativeDate.deltaDaySteps === 1:
                time = date.toLocaleFormat('%X').replace(/:\d\d$/, ' ');
                label.value = bundle.formatStringFromName('lastUpdated.yesterday', [time], 1);
                break;

            case relativeDate.deltaDaySteps < 7:
                pluralForms = bundle.GetStringFromName('day.pluralForms');
                form = this.common.getPluralForm(relativeDate.deltaDays, pluralForms);
                label.value = bundle.formatStringFromName('lastUpdated.ago', [form], 1)
                                    .replace('#number', relativeDate.deltaDays);
                break;

            case relativeDate.deltaYearSteps === 0:
                time = date.toLocaleFormat('%d %B').replace(/^0/, '');
                label.value = bundle.formatStringFromName('lastUpdated.fullDate', [time], 1);
                break;

            default:
                time = date.toLocaleFormat('%d %B %Y').replace(/^0/, '');
                label.value = bundle.formatStringFromName('lastUpdated.fullDate', [time], 1);
                break;
        }

        let rows = document.getElementById('brief-tooltip-rows');
        let tooltip = document.getElementById('brief-tooltip');

        while (rows.lastChild)
            rows.removeChild(rows.lastChild);

        let query = new this.query({
            deleted: this.storage.ENTRY_STATE_NORMAL,
            read: false,
            sortOrder: this.query.SORT_BY_FEED_ROW_INDEX,
            sortDirection: this.query.SORT_ASCENDING
        })

        query.getProperty('feedID', true).then(unreadFeeds => {
            let noUnreadLabel = document.getElementById('brief-tooltip-no-unread');
            let value = bundle.GetStringFromName('noUnreadFeedsTooltip');
            noUnreadLabel.setAttribute('value', value);
            noUnreadLabel.hidden = unreadFeeds.length;

            for (let feed of unreadFeeds) {
                let row = document.createElement('row');
                row.setAttribute('class', 'unread-feed-row');
                row = rows.appendChild(row);

                let feedName = this.storage.getFeed(feed).title;
                let label = document.createElement('label');
                label.setAttribute('class', 'unread-feed-name');
                label.setAttribute('crop', 'right');
                label.setAttribute('value', feedName);
                row.appendChild(label);

                let query = new this.query({
                    deleted: this.storage.ENTRY_STATE_NORMAL,
                    feeds: [feed],
                    read: false
                })

                query.getEntryCount().then(unreadCount => {
                    let label = document.createElement('label');
                    label.setAttribute('class', 'unread-entries-count');
                    label.setAttribute('value', unreadCount);
                    row.appendChild(label);
                })
            }
        })
    },

    onFirstRun: function Brief_onFirstRun() {
        CustomizableUI.addWidgetToArea('brief-button', CustomizableUI.AREA_NAVBAR);

        this.prefs.setBoolPref('firstRun', false);

        AddonManager.getAddonByID('brief@mozdev.org', addon => {
            this.prefs.setCharPref('lastVersion', addon.version);
        })

        // Load the first run page.
        setTimeout(() => {
            let parameters = { relatedToCurrent: false, inBackground: false };
            gBrowser.loadOneTab(Brief.FIRST_RUN_PAGE_URL, parameters)
        }, 0)
    }

}

window.addEventListener('load', Brief.onWindowLoad.bind(Brief), false);
