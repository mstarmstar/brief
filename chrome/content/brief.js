const TEMPLATE_URL = 'resource://brief-content/feedview-template.html';
const GUIDE_PAGE_URL = 'http://brief.mozdev.org/guide/guide.html';
const LAST_MAJOR_VERSION = '1.2';
const RELEASE_NOTES_URL = 'http://brief.mozdev.org/versions/1.2.html';

var Cc = Components.classes;
var Ci = Components.interfaces;

const gStorage = Cc['@ancestor/brief/storage;1'].getService(Ci.nsIBriefStorage);
const gUpdateService = Cc['@ancestor/brief/updateservice;1'].getService(Ci.nsIBriefUpdateService);
var QuerySH = Components.Constructor('@ancestor/brief/query;1', 'nsIBriefQuery', 'setEntries');
var Query = Components.Constructor('@ancestor/brief/query;1', 'nsIBriefQuery');

const ENTRY_STATE_NORMAL = Ci.nsIBriefQuery.ENTRY_STATE_NORMAL;
const ENTRY_STATE_TRASHED = Ci.nsIBriefQuery.ENTRY_STATE_TRASHED;
const ENTRY_STATE_DELETED = Ci.nsIBriefQuery.ENTRY_STATE_DELETED;
const ENTRY_STATE_ANY = Ci.nsIBriefQuery.ENTRY_STATE_ANY;

var gPrefBranch = Cc['@mozilla.org/preferences-service;1'].
                    getService(Ci.nsIPrefService).
                    getBranch('extensions.brief.').
                    QueryInterface(Ci.nsIPrefBranch2);

__defineGetter__('gTemplateURI', function() {
    delete this.gTemplateURI;
    return this.gTemplateURI = Cc['@mozilla.org/network/io-service;1'].
                               getService(Ci.nsIIOService).
                               newURI(TEMPLATE_URL, null, null);
});
__defineGetter__('gStringBundle', function() {
    delete this.gStringBundle;
    return this.gStringBundle = getElement('main-bundle');
});


function init() {
    gPrefs.register();

    getElement('headlines-checkbox').checked = gPrefs.showHeadlinesOnly;
    getElement('filter-unread-checkbox').checked = gPrefs.filterUnread;
    getElement('filter-starred-checkbox').checked = gPrefs.filterStarred;
    getElement('reveal-sidebar-button').hidden = !getElement('sidebar').hidden;

    document.addEventListener('keypress', onKeyPress, true);

    // This listener has to use capturing, because it handles persisting of open/collapsed
    // folder state. If the tree is scrolled as a result of collapsing a folder, we can
    // no longer find the target of the click event, because event.clientY points to
    // where it used to be before scrolling occurred. Therefore, we have to catch the
    // click event before the folder is actually collapsed.
    gFeedList.tree.addEventListener('click', gFeedList.onClick, true);

    var observerService = Cc['@mozilla.org/observer-service;1'].
                          getService(Ci.nsIObserverService);

    observerService.addObserver(gFeedList, 'brief:feed-update-queued', false);
    observerService.addObserver(gFeedList, 'brief:feed-update-canceled', false);
    observerService.addObserver(gFeedList, 'brief:feed-updated', false);
    observerService.addObserver(gFeedList, 'brief:feed-loading', false);
    observerService.addObserver(gFeedList, 'brief:feed-error', false);
    observerService.addObserver(gFeedList, 'brief:invalidate-feedlist', false);
    observerService.addObserver(gFeedList, 'brief:feed-title-changed', false);
    observerService.addObserver(gFeedList, 'brief:custom-style-changed', false);

    gStorage.addObserver(gFeedList);

    gViewList.init();
    async(gFeedList.rebuild, 0, gFeedList);
    async(loadHomeview);

    async(gStorage.syncWithLivemarks, 2000, gStorage);
}


function unload() {
    var observerService = Cc['@mozilla.org/observer-service;1'].
                          getService(Ci.nsIObserverService);
    observerService.removeObserver(gFeedList, 'brief:feed-updated');
    observerService.removeObserver(gFeedList, 'brief:feed-loading');
    observerService.removeObserver(gFeedList, 'brief:feed-error');
    observerService.removeObserver(gFeedList, 'brief:feed-update-queued');
    observerService.removeObserver(gFeedList, 'brief:feed-update-canceled');
    observerService.removeObserver(gFeedList, 'brief:invalidate-feedlist');
    observerService.removeObserver(gFeedList, 'brief:feed-title-changed');
    observerService.removeObserver(gFeedList, 'brief:custom-style-changed');

    gPrefs.unregister();
    gStorage.removeObserver(gFeedList);
    gFeedView.uninit();
}


var gCommands = {

    hideSidebar: function cmd_hideSidebar() {
        getElement('sidebar').hidden = true;
        getElement('sidebar-splitter').hidden = true;
        getElement('tag-list').hidden = true;
        getElement('tag-list-splitter').hidden = true;

        getElement('reveal-sidebar-button').hidden = false;
    },

    revealSidebar: function cmd_revealSidebar() {
        getElement('sidebar').hidden = false;
        getElement('sidebar-splitter').hidden = false;

        if (gViewList.selectedItem == getElement('starred-folder') || gTagList.selectedItem) {
            getElement('tag-list').hidden = false;
            getElement('tag-list-splitter').hidden = false;
        }

        getElement('reveal-sidebar-button').hidden = true;

        if (!gFeedList.treeReady)
            gFeedList.rebuild();
    },

    updateAllFeeds: function cmd_updateAllFeeds() {
        gUpdateService.updateAllFeeds();
    },

    stopUpdating: function cmd_stopUpdating() {
        gUpdateService.stopUpdating();
        getElement('update-buttons-deck').selectedIndex = 0;
    },

    openOptions: function cmd_openOptions(aPaneID) {
        var prefBranch = Cc['@mozilla.org/preferences-service;1'].
                         getService(Ci.nsIPrefBranch);
        var instantApply = prefBranch.getBoolPref('browser.preferences.instantApply');
        var features = 'chrome,titlebar,toolbar,centerscreen,resizable,';
        features += instantApply ? 'modal=no,dialog=no' : 'modal';

        window.openDialog('chrome://brief/content/options/options.xul', 'Brief options',
                          features, aPaneID);
    },

    markViewRead: function cmd_markViewRead() {
        gFeedView.query.markEntriesRead(true);
    },

    markVisibleEntriesRead: function cmd_markVisibleEntriesRead() {
        gFeedView.markVisibleEntriesRead();
    },

    switchHeadlinesView: function cmd_switchHeadlinesView() {
        var newState = !gPrefs.showHeadlinesOnly;
        gPrefBranch.setBoolPref('feedview.showHeadlinesOnly', newState);
        getElement('headlines-checkbox').checked = newState;
    },

    showAllEntries: function cmd_showAllEntries() {
        gPrefBranch.setBoolPref('feedview.filterUnread', false);
        getElement('filter-unread-checkbox').checked = false;

        gPrefBranch.setBoolPref('feedview.filterStarred', false);
        getElement('filter-starred-checkbox').checked = false;

        gFeedView.refresh();
    },

    showUnreadEntries: function cmd_showUnreadEntries() {
        if (!gPrefs.filterUnread)
            gCommands.toggleUnreadEntriesFilter();
    },

    toggleUnreadEntriesFilter: function cmd_toggleUnreadEntriesFilter() {
        gPrefBranch.setBoolPref('feedview.filterUnread', !gPrefs.filterUnread);
        getElement('filter-unread-checkbox').checked = gPrefs.filterUnread;
        gFeedView.refresh();
    },

    showStarredEntries: function cmd_showStarredEntries() {
        if (!gPrefs.filterStarred)
            gCommands.toggleStarredEntriesFilter();
    },

    toggleStarredEntriesFilter: function cmd_toggleStarredEntriesFilter() {
        gPrefBranch.setBoolPref('feedview.filterStarred', !gPrefs.filterStarred);
        getElement('filter-starred-checkbox').checked = gPrefs.filterStarred;
        gFeedView.refresh();
    },

    selectNextEntry: function cmd_selectNextEntry() {
        gFeedView.selectNextEntry();
    },

    selectPrevEntry: function cmd_selectPrevEntry() {
        gFeedView.selectPrevEntry();
    },

    skipDown: function cmd_skipDown() {
        gFeedView.skipDown();
    },

    skipUp: function cmd_skipUp() {
        gFeedView.skipUp();
    },

    focusSearchbar: function cmd_focusSearchbar() {
        getElement('searchbar').focus();
    },

    toggleEntrySelection: function toggleEntrySelection() {
        var oldValue = gPrefs.entrySelectionEnabled;
        gPrefBranch.setBoolPref('feedview.entrySelectionEnabled', !oldValue);
    },

    switchSelectedEntryRead: function cmd_switchSelectedEntryRead() {
        if (gFeedView.selectedEntry) {
            var newState = !gFeedView.selectedElement.hasAttribute('read');
            this.markEntryRead(gFeedView.selectedEntry, newState);
        }
    },

    markEntryRead: function cmd_markEntryRead(aEntry, aNewState) {
        var query = new QuerySH([aEntry]);
        query.markEntriesRead(aNewState);

        if (gPrefs.autoMarkRead && !aNewState)
            gFeedView.entriesMarkedUnread.push(aEntry);
    },

    deleteOrRestoreSelectedEntry: function cmd_deleteOrRestoreSelectedEntry() {
        if (gFeedView.selectedEntry) {
            if (gFeedView.query.deleted == ENTRY_STATE_TRASHED)
                this.restoreEntry(gFeedView.selectedEntry);
            else
                this.deleteEntry(gFeedView.selectedEntry);
        }
    },

    deleteEntry: function cmd_deleteEntry(aEntry) {
        var query = new QuerySH([aEntry]);
        query.deleteEntries(ENTRY_STATE_TRASHED);
    },

    restoreEntry: function cmd_restoreEntry(aEntry) {
        var query = new QuerySH([aEntry]);
        query.deleteEntries(ENTRY_STATE_NORMAL);
    },

    switchSelectedEntryStarred: function cmd_switchSelectedEntryStarred() {
        if (gFeedView.selectedEntry) {
            var newState = !gFeedView.selectedElement.hasAttribute('starred');
            this.starEntry(gFeedView.selectedEntry, newState);
        }
    },

    starEntry: function cmd_starEntry(aEntry, aNewState) {
        var query = new QuerySH([aEntry]);
        query.starEntries(aNewState);
    },

    switchSelectedEntryCollapsed: function cmd_switchSelectedEntryCollapsed() {
        if (gFeedView.selectedEntry && gPrefs.showHeadlinesOnly) {
            var selectedElement = gFeedView.selectedElement;
            var newState = !selectedElement.hasAttribute('collapsed');
            gFeedView.collapseEntry(gFeedView.selectedEntry, newState, true);
        }
    },


    openSelectedEntryLink: function cmd_openSelectedEntryLink() {
        if (gFeedView.selectedEntry) {
            let newTab = gPrefBranch.getBoolPref('feedview.openEntriesInTabs');
            gCommands.openEntryLink(gFeedView.selectedElement, newTab);
        }
    },

    openEntryLink: function cmd_openEntryLink(aEntryElement, aNewTab) {
        var url = aEntryElement.getAttribute('entryURL');
        gCommands.openLink(url, aNewTab);

        if (!aEntryElement.hasAttribute('read')) {
            aEntryElement.setAttribute('read', true);
            let entryID = parseInt(aEntryElement.id);
            let query = new QuerySH([entryID]);
            query.markEntriesRead(true);
        }
    },

    openLink: function cmd_openLink(aURL, aNewTab) {
        var docURI = Cc['@mozilla.org/network/io-service;1'].
                     getService(Ci.nsIIOService).
                     newURI(document.documentURI, null, null);

        if (aNewTab)
            getTopWindow().gBrowser.loadOneTab(aURL, docURI);
        else
            gFeedView.browser.loadURI(aURL);
    },

    displayShortcuts: function cmd_displayShortcuts() {
        var height = Math.min(window.screen.availHeight, 630);
        var features = 'chrome,centerscreen,titlebar,resizable,width=500,height=' + height;
        var url = 'chrome://brief/content/keyboard-shortcuts.xhtml';

        window.openDialog(url, 'Brief shortcuts', features);
    }
}


function loadHomeview() {
    var prevVersion = gPrefBranch.getCharPref('lastMajorVersion');
    var verComparator = Cc['@mozilla.org/xpcom/version-comparator;1'].
                        getService(Ci.nsIVersionComparator);

    // If Brief has been updated, load the new version info page.
    if (verComparator.compare(prevVersion, LAST_MAJOR_VERSION) < 0) {
        let browser = getElement('feed-view');
        browser.loadURI(RELEASE_NOTES_URL);
        gPrefBranch.setCharPref('lastMajorVersion', LAST_MAJOR_VERSION);
        getElement('feed-view-toolbar').hidden = true;
    }
    else {
        let query = new Query();
        query.deleted = ENTRY_STATE_NORMAL;
        let name = getElement('all-items-folder').getAttribute('name');
        gFeedView = new FeedView(name, query);

        gViewList.richlistbox.suppressOnSelect = true;
        gViewList.selectedItem = getElement('all-items-folder');
        gViewList.richlistbox.suppressOnSelect = false;
    }
}


function refreshProgressmeter() {
    var progressmeter = getElement('update-progress');
    var progress = 100 * gUpdateService.completedFeedsCount /
                         gUpdateService.scheduledFeedsCount;
    progressmeter.value = progress;

    if (progress == 100) {
        async(function() { getElement('update-progress-deck').selectedIndex = 0 }, 500);
        getElement('update-buttons-deck').selectedIndex = 0;
    }
}


function onSearchbarCommand() {
    var searchbar = getElement('searchbar');
    if (searchbar.value) {
        gFeedView.titleOverride = gStringBundle.getFormattedString('searchResults',
                                                                   [searchbar.value]);
    }
    else {
        gFeedView.titleOverride = '';
    }

    gFeedView.query.searchString = searchbar.value;
    gFeedView.refresh();
}

function onSearchbarBlur() {
    var searchbar = getElement('searchbar');
    if (!searchbar.value && gFeedView.query.searchString) {
        gFeedView.titleOverride = '';
        gFeedView.query.searchString = searchbar.value;
        gFeedView.refresh();
    }
}


/**
 * Space and Tab can't be captured using <key/> XUL elements, so we handle
 * them manually using a listener. Additionally, unlike other keys, they have to
 * be default-prevented.
 */
function onKeyPress(aEvent) {
    // Don't do anything if the user is typing in an input field.
    if (aEvent.originalTarget.localName.toUpperCase() == 'INPUT')
        return;

    // Stop propagation of character keys in order to disable Find-As-You-Type.
    if (aEvent.charCode)
        aEvent.stopPropagation();

    // Brief takes over these shortcut keys, so we stop the default action.
    if (gPrefBranch.getBoolPref('assumeStandardKeys')) {

        if (aEvent.keyCode == aEvent.DOM_VK_TAB && !aEvent.ctrlKey) {
            gPrefBranch.setBoolPref('feedview.entrySelectionEnabled',
                                    !gPrefs.entrySelectionEnabled);
            aEvent.preventDefault();
        }
        else if (aEvent.charCode == aEvent.DOM_VK_SPACE) {
            if (gPrefs.entrySelectionEnabled)
                gFeedView.selectNextEntry();
            else
                gFeedView.scrollToNextEntry(true);

            aEvent.preventDefault();
        }
    }
}

function onMarkViewReadClick(aEvent) {
    if (aEvent.ctrlKey)
        gCommands.markVisibleEntriesRead();
    else
        gCommands.markViewRead();
}

function getTopWindow() {
    return window.QueryInterface(Ci.nsIInterfaceRequestor).
           getInterface(Ci.nsIWebNavigation).
           QueryInterface(Ci.nsIDocShellTreeItem).
           rootTreeItem.
           QueryInterface(Ci.nsIInterfaceRequestor).
           getInterface(Ci.nsIDOMWindow);
}


// Preferences cache and observer.
var gPrefs = {

    register: function gPrefs_register() {
        for (key in this._cachedPrefs)
            this._updateCachedPref(key);

        gPrefBranch.addObserver('', this, false);
    },

    unregister: function gPrefs_unregister() {
        gPrefBranch.removeObserver('', this);
    },

    // Hash table of prefs which are cached and available as properties
    // of gPrefs. These properties are named after the respective keys.
    _cachedPrefs: {
        doubleClickMarks:          'feedview.doubleClickMarks',
        showHeadlinesOnly:         'feedview.showHeadlinesOnly',
        entrySelectionEnabled:     'feedview.entrySelectionEnabled',
        autoMarkRead:              'feedview.autoMarkRead',
        filterUnread:              'feedview.filterUnread',
        filterStarred:             'feedview.filterStarred',
        minInitialEntries:         'feedview.minInitialEntries',
        sortUnreadViewOldestFirst: 'feedview.sortUnreadViewOldestFirst',
        showFavicons:              'showFavicons',
        homeFolder:                'homeFolder'
    },

    _updateCachedPref: function gPrefs__updateCachedPref(aKey) {
        var prefName = this._cachedPrefs[aKey];

        switch (gPrefBranch.getPrefType(prefName)) {
            case Ci.nsIPrefBranch.PREF_STRING:
                this[aKey] = gPrefBranch.getCharPref(prefName);
                break;
            case Ci.nsIPrefBranch.PREF_INT:
                this[aKey] = gPrefBranch.getIntPref(prefName);
                break;
            case Ci.nsIPrefBranch.PREF_BOOL:
                this[aKey] = gPrefBranch.getBoolPref(prefName);
                break;
        }
    },

    observe: function gPrefs_observe(aSubject, aTopic, aData) {
        if (aTopic != 'nsPref:changed')
            return;

        for (key in this._cachedPrefs) {
            if (aData == this._cachedPrefs[key])
                this._updateCachedPref(key);
        }

        switch (aData) {
            case 'feedview.autoMarkRead':
                gFeedView._markVisibleAsRead();
                break;

            case 'feedview.sortUnreadViewOldestFirst':
                if (gFeedView.query.unread)
                    gFeedView.refresh();
                break;

            case 'feedview.entrySelectionEnabled':
                if (gPrefs.entrySelectionEnabled)
                    gFeedView.selectEntry(gFeedView._getMiddleEntryElement());
                else
                    gFeedView.selectEntry(null);
                break;

            case 'feedview.showHeadlinesOnly':
                gFeedView.toggleHeadlinesView();
                break;
        }
    }

}


// ------- Utility functions --------

function getElement(aId) document.getElementById(aId);

/**
 * Executes given function asynchronously. All arguments besides
 * the first one are optional.
 */
function async(aFunction, aDelay, aObject, arg1, arg2) {
    function asc() {
        aFunction.call(aObject || this, arg1, arg2);
    }
    return setTimeout(asc, aDelay || 0);
}

function intersect(arr1, arr2) {
    var commonPart = [];
    for (let i = 0; i < arr1.length; i++) {
        if (arr2.indexOf(arr1[i]) != -1)
            commonPart.push(arr1[i]);
    }
    return commonPart;
}

function log(aMessage) {
  var consoleService = Cc['@mozilla.org/consoleservice;1'].
                       getService(Ci.nsIConsoleService);
  consoleService.logStringMessage(aMessage);
}
