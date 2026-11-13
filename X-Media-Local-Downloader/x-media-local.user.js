// ==UserScript==
// @name         X/Twitter 媒体自动滚动下载器
// @name:en      X/Twitter Auto Scroll Media Downloader
// @name:zh-CN   X/Twitter 媒体自动滚动下载器（原图/最高码率）
// @name:zh-TW   X/Twitter 媒體自動滾動下載器（原圖/最高碼率）
// @version      3.2.0
// @description  X/Twitterの画像、動画、GIFをワンクリックでダウンロードします。標準ではユーザーIDとポストIDで保存されますが、追加される設定画面からファイル名や日時フォーマットを自由に変更可能です。iPhoneやAndroid環境でもZIP集約により複数メディアを一括ダウンロードできます。ダウンロード履歴のローカル保存に加え、オプションでXのブックマーク機能を利用したオンライン同期にも対応しています。
// @description:en   Download images, videos, and GIFs from X/Twitter with one click. By default, files are saved using the User ID and Post ID, but filenames and date formats can be freely customized via the integrated settings menu. Supports ZIP archiving for bulk downloads on iPhone and Android. In addition to local history tracking, it optionally features online synchronization using X's bookmark feature.
// @description:zh-CN 自动滚动 X/Twitter 页面，把帖子媒体快照按发现顺序放入内存队列；单线程顺序下载，图片使用 name=orig，视频选择最高码率 MP4，并使用全局随机时钟。
// @description:zh-TW 自動滾動 X/Twitter 頁面，把貼文媒體快照按發現順序放入記憶體佇列；單執行緒順序下載，圖片使用 name=orig，影片選擇最高碼率 MP4，並使用全域隨機時鐘。
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js
// @require      https://cdn.jsdelivr.net/npm/pinyin-pro@3.18.2/dist/index.js
// @require      https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js
// @require      https://cdn.jsdelivr.net/npm/dayjs@1.11.13/plugin/utc.js
// @author       Azuki
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitter.com
// @connect      twitter.com
// @connect      x.com
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @namespace    https://greasyfork.org/users/1441951
// @homepage     https://x.com/Azuki_0147
// ==/UserScript==
/*jshint esversion: 11 */

dayjs.extend(dayjs_plugin_utc);

(function () {
    "use strict";

    localStorage.removeItem('twitterInternalApiInfo');
    localStorage.removeItem('twitterApiInfoLastUpdateDate');

    let enableDownloadHistorySync = localStorage.getItem('twdl_enableSync') === 'true';

    const defaultFilenameFormat = '{userId}-{postId}-{mediaType}{index}';
    let filenameFormat = localStorage.getItem('twdl_filenameFormat')
        || localStorage.getItem('twdl_customFilenameFormat')
        || defaultFilenameFormat;
    let customFilenameFormat = filenameFormat;
    let filenameMode = localStorage.getItem('twdl_filenameMode') || 'custom';

    const setFilenameTemplate = (value) => {
        const next = String(value || '').trim() || defaultFilenameFormat;
        filenameFormat = next;
        customFilenameFormat = next;
        localStorage.setItem('twdl_filenameFormat', next);
        localStorage.setItem('twdl_customFilenameFormat', next);
        return next;
    };

    let postTimeFormat = localStorage.getItem('twdl_postTimeFormat') || 'YYYYMMDD_HHmmss';

    let downloadMode = localStorage.getItem('twdl_downloadMode') || 'blob';

    const normalizePostText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const sanitizeFilename = (value, fallback = 'media') => {
        const cleaned = String(value || '')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[. ]+$/g, '')
            .slice(0, 120);
        if (!cleaned) return fallback;
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return '_' + cleaned;
        return cleaned;
    };

    const toPinyin = (text) => {
        const source = normalizePostText(text);
        if (!source) return '';
        try {
            const api = typeof pinyinPro !== 'undefined' ? pinyinPro : window.pinyinPro;
            if (api && typeof api.pinyin === 'function') {
                return normalizePostText(api.pinyin(source, { toneType: 'none' })).replace(/\s+/g, '-');
            }
        } catch (error) {
            console.warn('[TMD] pinyin-pro conversion failed:', error);
        }
        return source;
    };

    const generateFilename = (filenameElements, mediaTypeLabel, index, ext, totalCount = 1) => {
        const { userId, userName, postId, postTime, postText = '' } = filenameElements;
        const formattedPostTime = dayjs(postTime).format(postTimeFormat);
        const userPinyin = toPinyin(userName);
        const template = filenameFormat || customFilenameFormat || defaultFilenameFormat;
        const values = {
            userId: userId || 'unknown',
            userName: userName || 'unknown',
            userPinyin: userPinyin || userName || 'unknown',
            postId: postId || 'unknown',
            postTime: formattedPostTime,
            text: normalizePostText(postText),
            mediaType: mediaTypeLabel || 'media',
            index: index || '',
            ext: ext || 'bin'
        };

        let baseName = '';
        if (filenameMode === 'postText') {
            baseName = values.text || values.userId + '-' + values.postId;
        } else if (filenameMode === 'userName') {
            baseName = values.userName + '-' + values.postTime;
        } else if (filenameMode === 'userPinyin') {
            baseName = values.userPinyin + '-' + values.postTime;
        } else {
            baseName = template
                .replace(/{userId}/g, values.userId)
                .replace(/{userName}/g, values.userName)
                .replace(/{userPinyin}/g, values.userPinyin)
                .replace(/{postId}/g, values.postId)
                .replace(/{postTime}/g, values.postTime)
                .replace(/{text}/g, values.text)
                .replace(/{mediaType}/g, values.mediaType)
                .replace(/{index}/g, values.index)
                .replace(/{ext}/g, values.ext);
        }

        if (filenameMode !== 'custom' && totalCount > 1) {
            baseName = baseName + '-' + values.mediaType + values.index;
        }

        const safeBaseName = sanitizeFilename(baseName, values.userId + '-' + values.postId);
        return safeBaseName.toLowerCase().endsWith('.' + String(ext).toLowerCase())
            ? safeBaseName
            : safeBaseName + '.' + ext;
    };

    const gmFetch = (infoOrUrl, options = {}) =>
        new Promise((resolve, reject) => {
            const info = typeof infoOrUrl === 'string' ? { url: infoOrUrl } : { ...infoOrUrl };
            const responseType = options.responseType || info.responseType || 'text';
            const defaultTimeout = responseType === 'blob' ? 120000 : 30000;
            const configuredTimeout = options.timeout ?? info.timeout;

            info.method = options.method || info.method || 'GET';
            info.headers = options.headers || info.headers || {};
            if (options.body) info.data = options.body;
            info.responseType = responseType;
            info.timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
                ? configuredTimeout
                : defaultTimeout;

            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                callback(value);
            };
            const requestUrl = String(info.url || '');

            info.onload = res => {
                const response = res.response;
                const responseSize = response instanceof Blob
                    ? response.size
                    : response instanceof ArrayBuffer
                        ? response.byteLength
                        : null;
                console.log(`[TMD] gmFetch: 响应 status=${res.status}, type=${responseType}, size=${responseSize ?? 'unknown'} URL=${requestUrl}`);
                finish(resolve, {
                    ok: res.status >= 200 && res.status < 300,
                    status: res.status,
                    response,
                    json: () => Promise.resolve(response),
                    text: () => Promise.resolve(
                        typeof response === 'string' ? response : JSON.stringify(response)
                    ),
                    blob: () => {
                        if (response instanceof Blob) return Promise.resolve(response);
                        if (response instanceof ArrayBuffer) return Promise.resolve(new Blob([response]));
                        return Promise.resolve(new Blob([response]));
                    }
                });
            };
            info.onerror = (error) => {
                const message = `GM_xmlhttpRequest failed: status=${error?.status || 0}, statusText=${error?.statusText || 'N/A'}`;
                console.error(`[TMD] gmFetch: ${message} URL=${requestUrl}`, error);
                finish(reject, new Error(message));
            };
            info.onabort = () => {
                const error = new Error(`GM_xmlhttpRequest aborted URL=${requestUrl}`);
                console.warn('[TMD] gmFetch:', error.message);
                finish(reject, error);
            };
            info.ontimeout = () => {
                const error = new Error(`GM_xmlhttpRequest timed out after ${info.timeout} ms URL=${requestUrl}`);
                console.warn('[TMD] gmFetch:', error.message);
                finish(reject, error);
            };

            try {
                console.log(`[TMD] gmFetch: 请求开始 timeout=${info.timeout} ms URL=${requestUrl}`);
                GM_xmlhttpRequest(info);
            } catch (error) {
                finish(reject, error);
            }
        });

    const DB_NAME = 'DownloadHistoryDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'downloadedPosts';

    let dbPromise = null;
    let downloadedPostsCache = new Set();

    const openDB = () => {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function (event) {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'postId' });
                }
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
            request.onerror = function () {
                reject(request.error);
            };
        });
        return dbPromise;
    };

    const loadDownloadedPostsCache = () => {
        return getDownloadedPostIdsIndexedDB()
            .then(ids => {
                downloadedPostsCache = new Set(ids);
            })
            .catch(err => {
                console.error("IndexedDB 読み込みエラー:", err);
            });
    };

    const getDownloadedPostIdsIndexedDB = () => {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAllKeys();
                request.onsuccess = function () {
                    resolve(request.result);
                };
                request.onerror = function () {
                    reject(request.error);
                };
            });
        });
    };

    const markPostAsDownloadedIndexedDB = (postId) => {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put({ postId: postId });
                request.onsuccess = function () {
                    downloadedPostsCache.add(postId);
                    resolve();
                };
                request.onerror = function () {
                    reject(request.error);
                };
            });
        });
    };

    const removePostAsDownloadedIndexedDB = (postId) => {
        downloadedPostsCache.delete(postId);
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const request = transaction.objectStore(STORE_NAME).delete(postId);
                request.onsuccess = function () {
                    resolve();
                };
                request.onerror = function () {
                    reject(request.error);
                };
            });
        });
    };

    const downloadedCacheReady = loadDownloadedPostsCache();

    const isMobile = /android|iphone|ipad|mobile/.test(navigator.userAgent.toLowerCase());
    const isAppleMobile = /iphone|ipad/.test(navigator.userAgent.toLowerCase());
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

    const createApiHeaders = () => {
        const GUEST_AUTHORIZATION = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

        const headers = {
            'authorization': GUEST_AUTHORIZATION,
            'x-csrf-token': getCookie('ct0'),
            'x-twitter-client-language': 'en',
            'x-twitter-active-user': 'yes',
            'content-type': 'application/json'
        };

        const guestToken = getCookie('gt');
        if (guestToken) {
            headers['x-guest-token'] = guestToken;
        } else {
            headers['x-twitter-auth-type'] = 'OAuth2Session';
        }

        return headers;
    };

    const getCurrentLanguage = () => document.documentElement.lang || 'en';
    const getMainTweetUrl = (cell) => {
        let timeEl = cell.querySelector('article[data-testid="tweet"] a[href*="/status/"][role="link"] time');
        if (timeEl && timeEl.parentElement) return timeEl.parentElement.href;
        return cell.querySelector('article[data-testid="tweet"] a[href*="/status/"]')?.href || "";
    };
    const getCookie = (name) => {
        const cookies = Object.fromEntries(document.cookie.split(';').filter(n => n.includes('=')).map(n => n.split('=').map(decodeURIComponent).map(s => s.trim())));
        return name ? cookies[name] : cookies;
    };
    const getMediaInfoFromUrl = (url) => {
        if (url.includes('pbs.twimg.com/media/')) {
            const extMatch = url.match(/format=([a-zA-Z0-9]+)/);
            const ext = extMatch ? extMatch[1] : 'jpg';
            return { ext: ext, typeLabel: 'img' };
        } else if (url.includes('video.twimg.com/ext_tw_video/') || url.includes('video.twimg.com/tweet_video/') || url.includes('video.twimg.com/amplify_video/')) {
            let ext = 'mp4';
            if (!url.includes('video.twimg.com/tweet_video/')) {
                const pathMatch = url.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
                if (pathMatch) ext = pathMatch[1];
            }
            const typeLabel = url.includes('tweet_video') ? 'gif' : 'video';
            return { ext: ext, typeLabel: typeLabel };
        }
        return { ext: 'jpg', typeLabel: 'img' };
    };

    const fetchTweetDetailWithGraphQL = async (postId) => {
        const TWEET_RESULT_BY_REST_ID_QUERY_ID = "zAz9764BcLZOJ0JU2wrd1A";

        const TWEET_DETAIL_FEATURES = {
            "creator_subscriptions_tweet_preview_api_enabled": true,
            "premium_content_api_read_enabled": false,
            "communities_web_enable_tweet_community_results_fetch": true,
            "c9s_tweet_anatomy_moderator_badge_enabled": true,
            "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
            "responsive_web_grok_analyze_post_followups_enabled": false,
            "responsive_web_jetfuel_frame": false,
            "responsive_web_grok_share_attachment_enabled": true,
            "articles_preview_enabled": true,
            "responsive_web_edit_tweet_api_enabled": true,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
            "view_counts_everywhere_api_enabled": true,
            "longform_notetweets_consumption_enabled": true,
            "responsive_web_twitter_article_tweet_consumption_enabled": true,
            "tweet_awards_web_tipping_enabled": false,
            "responsive_web_grok_show_grok_translated_post": false,
            "responsive_web_grok_analysis_button_from_backend": false,
            "creator_subscriptions_quote_tweet_preview_enabled": false,
            "freedom_of_speech_not_reach_fetch_enabled": true,
            "standardized_nudges_misinfo": true,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
            "longform_notetweets_rich_text_read_enabled": true,
            "longform_notetweets_inline_media_enabled": true,
            "profile_label_improvements_pcf_label_in_post_enabled": true,
            "rweb_tipjar_consumption_enabled": true,
            "verified_phone_label_enabled": false,
            "responsive_web_grok_image_annotation_enabled": true,
            "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
            "responsive_web_graphql_timeline_navigation_enabled": true,
            "responsive_web_enhance_cards_enabled": false
        };

        const TWEET_DETAIL_FIELD_TOGGLES = {
            "withArticleRichContentState": true, "withArticlePlainText": false,
            "withGrokAnalyze": false, "withDisallowedReplyControls": false
        };

        const variables = {
            "tweetId": postId, "withCommunity": false,
            "includePromotedContent": false, "withVoice": false
        };

        const apiUrl = `https://x.com/i/api/graphql/${TWEET_RESULT_BY_REST_ID_QUERY_ID}/TweetResultByRestId`;
        const url = `${apiUrl}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(TWEET_DETAIL_FEATURES))}&fieldToggles=${encodeURIComponent(JSON.stringify(TWEET_DETAIL_FIELD_TOGGLES))}`;

        const headers = createApiHeaders();
        if (!headers) {
            throw new Error('tweetResultByRestId headers not available.');
        }

        const res = await gmFetch(url, { headers, responseType: 'json' });
        if (!res.ok) throw new Error(`TweetResultByRestId failed: ${res.status}`);

        return res.json();
    };

    const fetchBookmarkSearchTimeline = async (userId, postTime) => {
        const BOOKMARK_SEARCH_TIMELINE_QUERY_ID = "6u3VcFdASPZrP2wkuU3C3A";

        const BOOKMARK_SEARCH_FEATURES = {
            "rweb_video_screen_enabled": false,
            "payments_enabled": false,
            "profile_label_improvements_pcf_label_in_post_enabled": true,
            "rweb_tipjar_consumption_enabled": true,
            "verified_phone_label_enabled": false,
            "creator_subscriptions_tweet_preview_api_enabled": true,
            "responsive_web_graphql_timeline_navigation_enabled": true,
            "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
            "premium_content_api_read_enabled": false,
            "communities_web_enable_tweet_community_results_fetch": true,
            "c9s_tweet_anatomy_moderator_badge_enabled": true,
            "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
            "responsive_web_grok_analyze_post_followups_enabled": true,
            "responsive_web_jetfuel_frame": true,
            "responsive_web_grok_share_attachment_enabled": true,
            "articles_preview_enabled": true,
            "responsive_web_edit_tweet_api_enabled": true,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
            "view_counts_everywhere_api_enabled": true,
            "longform_notetweets_consumption_enabled": true,
            "responsive_web_twitter_article_tweet_consumption_enabled": true,
            "tweet_awards_web_tipping_enabled": false,
            "responsive_web_grok_show_grok_translated_post": false,
            "responsive_web_grok_analysis_button_from_backend": false,
            "creator_subscriptions_quote_tweet_preview_enabled": false,
            "freedom_of_speech_not_reach_fetch_enabled": true,
            "standardized_nudges_misinfo": true,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
            "longform_notetweets_rich_text_read_enabled": true,
            "longform_notetweets_inline_media_enabled": true,
            "responsive_web_grok_image_annotation_enabled": true,
            "responsive_web_grok_community_note_auto_translation_is_enabled": false,
            "responsive_web_enhance_cards_enabled": false
        };

        const formattedSinceTime = dayjs(postTime).utc().format('YYYY-MM-DD_HH:mm:ss_UTC');
        const formattedUntilTime = dayjs(postTime).utc().add(1, 'second').format('YYYY-MM-DD_HH:mm:ss_UTC');
        const rawQuery = `from:${userId} since:${formattedSinceTime} until:${formattedUntilTime}`;
        const variables = { "rawQuery": rawQuery, "count": 20 };

        const apiUrl = `https://x.com/i/api/graphql/${BOOKMARK_SEARCH_TIMELINE_QUERY_ID}/BookmarkSearchTimeline`;
        const url = `${apiUrl}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(BOOKMARK_SEARCH_FEATURES))}`;

        const headers = createApiHeaders();
        if (!headers) {
            throw new Error('BookmarkSearchTimeline headers not available.');
        }

        const res = await gmFetch(url, { headers, responseType: 'json' });
        if (!res.ok) throw new Error(`BookmarkSearchTimeline failed: ${res.status}`);

        return res.json();
    };

    const twdlcss = `
    span[id^="ezoic-pub-ad-placeholder-"], .ez-sidebar-wall, span[data-ez-ph-id], .ez-sidebar-wall-ad, .ez-sidebar-wall {display:none !important}
    .tmd-down {margin-left: 2px !important; order: 99; justify-content: inherit; display: inline-grid; transform: rotate(0deg) scale(1) translate3d(0px, 0px, 0px);}
    .tmd-down:hover > div > div > div > div {color: rgba(29, 161, 242, 1.0);}
    .tmd-down:hover > div > div > div > div > div {background-color: rgba(29, 161, 242, 0.1);}
    .tmd-down:active > div > div > div > div > div {background-color: rgba(29, 161, 242, 0.2);}
    .tmd-down:hover svg {color: rgba(29, 161, 242, 1.0);}
    .tmd-down:hover div:first-child:not(:last-child) {background-color: rgba(29, 161, 242, 0.1);}
    .tmd-down:active div:first-child:not(:last-child) {background-color: rgba(29, 161, 242, 0.2);}
    .tmd-down g {display: none;}
    .tmd-down.download g.download, .tmd-down.loading g.loading, .tmd-down.failed g.failed, .tmd-down.completed g.completed {display: unset;}
    .tmd-down.loading svg g.loading {animation: spin 1s linear infinite !important; transform-box: fill-box; transform-origin: center;}
    @keyframes spin {0% {transform: rotate(0deg);} 100% {transform: rotate(360deg);}}
    .tweet-detail-action-item {width: 20% !important;}

    /* 設定モーダル用CSS (ライトモード/デフォルト) */
    #twdl-settings-modal { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; justify-content: center; align-items: center; }
    #twdl-settings-content { background: #ffffff; color: #0f1419; border-radius: 16px; padding: 24px; width: 90%; max-width: 480px; box-shadow: 0 0 15px rgba(0,0,0,0.2); font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .twdl-modal-header { font-size: 20px; font-weight: bold; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .twdl-close-btn { cursor: pointer; font-size: 24px; padding: 5px; line-height: 1; border-radius: 50%; width: 32px; height: 32px; display: flex; justify-content: center; align-items: center; }
    .twdl-close-btn:hover { background: rgba(15, 20, 25, 0.1); }
    .twdl-input-field { width: 100%; padding: 10px; border: 1px solid #cfd9de; border-radius: 4px; box-sizing: border-box; background: transparent; color: inherit; margin-top: 8px; font-size: 15px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important; }

    /* Xの htmlタグの color-scheme に連動してダークモードUIを適用 */
    html[style*="color-scheme: dark"] #twdl-settings-content { background: rgb(22, 24, 28); color: #e7e9ea; }
    html[style*="color-scheme: dark"] .twdl-close-btn:hover { background: rgba(255, 255, 255, 0.1); }
    html[style*="color-scheme: dark"] .twdl-input-field { border-color: #38444d; color: #e7e9ea; }

    /* 設定メニューのホバーエフェクト */
    a[data-testid="twdlSettingsLink"] { transition: background-color 0.2s; }
    html[style*="color-scheme: light"] a[data-testid="twdlSettingsLink"]:hover { background-color: rgb(247, 249, 249) !important; }
    html[style*="color-scheme: dark"] a[data-testid="twdlSettingsLink"]:hover { background-color: rgb(22, 24, 28) !important; }

    #twdl-auto-panel { position: fixed; right: 16px; bottom: 16px; z-index: 9998; width: 320px; max-width: calc(100vw - 32px); padding: 14px; border: 1px solid #cfd9de; border-radius: 14px; background: rgba(255,255,255,0.98); color: #0f1419; box-shadow: 0 4px 18px rgba(0,0,0,0.18); font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 13px; }
    #twdl-auto-panel.twdl-collapsed .twdl-auto-body { display: none; }
    .twdl-auto-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 15px; font-weight: 700; }
    .twdl-auto-title button, .twdl-auto-action { border: 0; border-radius: 9999px; padding: 7px 10px; cursor: pointer; font: inherit; font-weight: 700; }
    .twdl-auto-title button { background: transparent; color: inherit; font-size: 16px; }
    .twdl-auto-status { margin: 8px 0 10px; line-height: 1.45; color: #536471; }
    .twdl-auto-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
    .twdl-auto-stat { padding: 6px; border-radius: 8px; background: rgba(29,161,242,0.08); text-align: center; }
    .twdl-auto-stat strong { display: block; font-size: 16px; color: #1d9bf0; }
    .twdl-auto-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
    .twdl-auto-action { background: #1d9bf0; color: #fff; }
    .twdl-auto-action.secondary { background: transparent; border: 1px solid #1d9bf0; color: #1d9bf0; }
    .twdl-auto-action.danger { background: #f4212e; }
    .twdl-auto-field { margin-top: 9px; }
    .twdl-auto-field label { display: block; margin-bottom: 4px; font-weight: 600; }
    .twdl-auto-field select, .twdl-auto-field input[type="text"], .twdl-auto-field input[type="number"] { width: 100%; box-sizing: border-box; padding: 7px 8px; border: 1px solid #cfd9de; border-radius: 7px; background: transparent; color: inherit; font: inherit; }
    .twdl-auto-inline { display: flex; align-items: center; gap: 8px; }
    .twdl-auto-inline input[type="number"] { width: 80px; }
    .twdl-auto-hint { margin-top: 4px; font-size: 11px; line-height: 1.35; color: #536471; }
    html[style*="color-scheme: dark"] #twdl-auto-panel { background: rgba(22,24,28,0.98); color: #e7e9ea; border-color: #38444d; }
    html[style*="color-scheme: dark"] .twdl-auto-field select, html[style*="color-scheme: dark"] .twdl-auto-field input[type="text"], html[style*="color-scheme: dark"] .twdl-auto-field input[type="number"] { border-color: #38444d; color: #e7e9ea; }
    html[style*="color-scheme: dark"] .twdl-auto-status, html[style*="color-scheme: dark"] .twdl-auto-hint { color: #8899a6; }
    `;
    const newStyle = document.createElement('style');
    newStyle.id = 'twdlcss';
    newStyle.innerHTML = twdlcss;
    document.head.parentNode.insertBefore(newStyle, document.head);

    const autoState = {
        running: false,
        paused: false,
        scanning: false,
        queue: [],
        queued: new Set(),
        seen: new Set(),
        active: new Set(),
        failed: new Set(),
        failedItems: new Map(),
        failedFiles: new Map(),
        listingFailures: false,
        completed: 0,
        skipped: 0,
        idleRounds: 0,
        queueSequence: 0,
        startBoundaryPostId: null,
        message: '准备就绪',
        scannerPromise: null,
        consumerPromise: null,
        runnerPromise: null
    };

    const MAX_AUTO_QUEUE_SIZE = 10000;
    const RANDOM_DELAY_MIN_MS = 20;
    const RANDOM_DELAY_MAX_MS = 2000;
    const RANDOM_DELAY_MIN_DIFF_MS = 20;
    let lastRandomDelayMs = null;
    let globalClockNextAt = 0;
    let globalClockTail = Promise.resolve();

    const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
    const getAutoIntervalSeconds = () => {
        const configured = localStorage.getItem('twdl_autoIntervalSeconds');
        if (configured !== null && configured !== '') {
            const parsed = Number.parseFloat(configured);
            if (Number.isFinite(parsed)) return Math.min(60, Math.max(0.5, parsed));
        }
        const legacyDelay = Number.parseInt(localStorage.getItem('twdl_autoScrollDelay') || '', 10);
        if (Number.isFinite(legacyDelay)) return Math.min(60, Math.max(0.5, legacyDelay / 1000));
        return 3;
    };
    let autoIntervalSeconds = getAutoIntervalSeconds();
    const setAutoIntervalSeconds = (value) => {
        const parsed = Number(value);
        const normalized = Number.isFinite(parsed)
            ? Math.min(60, Math.max(0.5, Math.round(parsed * 10) / 10))
            : autoIntervalSeconds;
        autoIntervalSeconds = normalized;
        localStorage.setItem('twdl_autoIntervalSeconds', String(normalized));
        localStorage.setItem('twdl_autoScrollDelay', String(Math.round(normalized * 1000)));
        return normalized;
    };
    const getAutoIntervalMilliseconds = () => autoIntervalSeconds * 1000;
    const isAutoScrollEnabled = () => localStorage.getItem('twdl_autoScroll') !== 'false';

    // Bounds are persisted only after editing is complete; keep the last valid pair.
    let delayMinMs = Number(localStorage.getItem('twdl_delayMinMs')) || 20;
    let delayMaxMs = Number(localStorage.getItem('twdl_delayMaxMs')) || 2000;
    if (!Number.isInteger(delayMinMs) || !Number.isInteger(delayMaxMs) || delayMinMs < 20 || delayMaxMs > 2000 || delayMaxMs - delayMinMs < 40) {
        delayMinMs = 20; delayMaxMs = 2000;
    }
    const pickRandomDelayMs = () => {
        const candidates = [];
        for (let n = delayMinMs; n <= delayMaxMs; n++) {
            if (lastRandomDelayMs === null || Math.abs(n - lastRandomDelayMs) >= RANDOM_DELAY_MIN_DIFF_MS) candidates.push(n);
        }
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        lastRandomDelayMs = chosen;
        return chosen;
    };

    // Shared clock spaces starts of individual media downloads.
    const waitForGlobalRandomClock = async (reason = '') => {
        let releaseClock;
        const previousClock = globalClockTail;
        globalClockTail = new Promise(resolve => { releaseClock = resolve; });
        await previousClock;
        try {
            const randomDelayMs = pickRandomDelayMs();
            const now = Date.now();
            const notBefore = Math.max(now, globalClockNextAt);
            const waitMs = Math.max(0, notBefore - now) + randomDelayMs;
            await sleep(waitMs);
            globalClockNextAt = Date.now();
            console.debug('[TMD] 全局随机时钟:', { reason, randomDelayMs, nextAt: globalClockNextAt });
            return randomDelayMs;
        } finally {
            releaseClock();
        }
    };

    const updateAutoPanel = () => {
        const panel = document.getElementById('twdl-auto-panel');
        if (!panel) return;
        const statusElement = panel.querySelector('#twdl-auto-status');
        const queueElement = panel.querySelector('#twdl-auto-queue');
        const doneElement = panel.querySelector('#twdl-auto-done');
        const failedElement = panel.querySelector('#twdl-auto-failed');
        const pauseButton = panel.querySelector('#twdl-auto-pause');
        const startButton = panel.querySelector('#twdl-auto-start');
        const customInput = panel.querySelector('#twdl-custom-filename');
        const filenameModeSelect = panel.querySelector('#twdl-filename-mode');
        const intervalInput = panel.querySelector('#twdl-auto-interval');
        const setText = (element, value) => {
            if (element && element.textContent !== value) element.textContent = value;
        };

        const stateText = autoState.running ? (autoState.paused ? '已暂停' : '运行中') : (autoState.active.size ? '正在收尾' : '已停止');
        setText(statusElement, stateText + ' · ' + autoState.message);
        setText(queueElement, String(autoState.queue.length + autoState.active.size));
        setText(doneElement, String(autoState.completed + autoState.skipped));
        setText(failedElement, String(autoState.failed.size));
        if (pauseButton) pauseButton.textContent = autoState.paused ? '继续' : '暂停';
        if (pauseButton) pauseButton.disabled = !autoState.running;
        if (startButton) startButton.textContent = autoState.running ? '运行中' : '开始';
        if (filenameModeSelect) filenameModeSelect.value = filenameMode;
        if (customInput) {
            if (document.activeElement !== customInput) customInput.value = filenameFormat;
            customInput.disabled = filenameMode !== 'custom';
        }
        if (intervalInput && document.activeElement !== intervalInput) {
            intervalInput.value = String(autoIntervalSeconds);
        }
    };

    const injectAutoPanel = () => {
        if (!document.body || document.getElementById('twdl-auto-panel')) return;
        const panel = document.createElement('section');
        panel.id = 'twdl-auto-panel';
        panel.innerHTML = [
            '<div class="twdl-auto-title"><span>X 媒体自动下载</span><button id="twdl-auto-collapse" type="button" title="折叠">−</button></div>',
            '<div class="twdl-auto-body">',
            '<div id="twdl-auto-status" class="twdl-auto-status">准备就绪</div>',
            '<div class="twdl-auto-stats"><div class="twdl-auto-stat"><strong id="twdl-auto-queue">0</strong><span>队列/进行中</span></div><div class="twdl-auto-stat"><strong id="twdl-auto-done">0</strong><span>完成</span></div><div class="twdl-auto-stat"><strong id="twdl-auto-failed">0</strong><span>失败</span></div></div>',
            '<div class="twdl-auto-actions"><button id="twdl-auto-start" class="twdl-auto-action" type="button">开始</button><button id="twdl-auto-start-current" class="twdl-auto-action secondary" type="button">从当前帖子开始</button><button id="twdl-auto-pause" class="twdl-auto-action secondary" type="button">暂停</button><button id="twdl-auto-stop" class="twdl-auto-action danger" type="button">停止</button><button id="twdl-auto-retry" class="twdl-auto-action secondary" type="button">列出失败</button><button id="twdl-auto-clear" class="twdl-auto-action secondary" type="button">清空队列</button></div>',
            '<div class="twdl-auto-field"><div class="twdl-auto-hint">自动下载由本机 Python 程序顺序保存；请先启动本地下载器。</div></div>',
            '<div class="twdl-auto-field"><label for="twdl-filename-mode">保存文件名</label><select id="twdl-filename-mode"><option value="postText">帖子文字内容</option><option value="userName">发帖人显示名称+发帖日期时间</option><option value="userPinyin">发帖人拼音名称+发帖日期时间</option><option value="custom">自定义模板</option></select></div>',
            '<div class="twdl-auto-field"><input id="twdl-custom-filename" type="text" placeholder="{userName}-{postId}-{mediaType}{index}"><div class="twdl-auto-hint">可用：{userId} {userName} {userPinyin} {postId} {postTime} {text} {mediaType} {index} {ext}</div></div>',
            '<div class="twdl-auto-field twdl-auto-inline"><label style="margin: 0; flex: 1;"><input id="twdl-auto-scroll" type="checkbox"> 自动滚动页面</label><input id="twdl-auto-interval" type="number" min="0.5" max="60" step="0.1" title="每隔多少秒扫描并滚动"><span>秒/轮</span></div>',
            '<div class="twdl-auto-field twdl-auto-inline"><label>下载间隔（毫秒）</label><input id="twdl-delay-min" type="number" min="20" max="1960" step="1"><span>至</span><input id="twdl-delay-max" type="number" min="60" max="2000" step="1"></div>',
            '<div class="twdl-auto-hint">范围 20–2000 ms，最大值须比最小值大至少 40 ms；相邻随机值相差至少 20 ms。</div>',
            '</div>'
        ].join('');
        document.body.appendChild(panel);

        panel.querySelector('#twdl-auto-collapse').addEventListener('click', () => panel.classList.toggle('twdl-collapsed'));
        panel.querySelector('#twdl-auto-start').addEventListener('click', () => startAutoDownload());
        panel.querySelector('#twdl-auto-start-current').addEventListener('click', () => startFromCurrentPost());
        panel.querySelector('#twdl-auto-pause').addEventListener('click', () => {
            if (autoState.running) autoState.paused = !autoState.paused;
            updateAutoPanel();
        });
        panel.querySelector('#twdl-auto-stop').addEventListener('click', () => stopAutoDownload());
        panel.querySelector('#twdl-auto-retry').addEventListener('click', () => listFailedDownloads());
        panel.querySelector('#twdl-auto-clear').addEventListener('click', () => clearAutoQueue());
        panel.querySelector('#twdl-filename-mode').addEventListener('change', (event) => {
            filenameMode = event.target.value;
            localStorage.setItem('twdl_filenameMode', filenameMode);
            updateAutoPanel();
        });
        panel.querySelector('#twdl-custom-filename').addEventListener('input', (event) => {
            setFilenameTemplate(event.target.value);
        });
        panel.querySelector('#twdl-auto-scroll').checked = isAutoScrollEnabled();
        panel.querySelector('#twdl-auto-scroll').addEventListener('change', (event) => localStorage.setItem('twdl_autoScroll', String(event.target.checked)));
        const intervalInput = panel.querySelector('#twdl-auto-interval');
        intervalInput.value = String(autoIntervalSeconds);
        intervalInput.addEventListener('input', (event) => {
            const raw = String(event.target.value || '').trim();
            if (!raw) return;
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) setAutoIntervalSeconds(parsed);
        });
        intervalInput.addEventListener('change', (event) => {
            const value = setAutoIntervalSeconds(event.target.value);
            event.target.value = String(value);
            updateAutoPanel();
        });
        const delayMinInput = panel.querySelector('#twdl-delay-min');
        const delayMaxInput = panel.querySelector('#twdl-delay-max');
        delayMinInput.value = String(delayMinMs);
        delayMaxInput.value = String(delayMaxMs);
        const saveDelayBounds = () => {
            const min = Number(delayMinInput.value), max = Number(delayMaxInput.value);
            if (!Number.isInteger(min) || !Number.isInteger(max) || min < 20 || max > 2000 || max - min < 40) {
                autoState.message = '间隔设置无效：范围 20–2000 ms，最大值须比最小值大至少 40 ms';
                delayMinInput.value = String(delayMinMs); delayMaxInput.value = String(delayMaxMs);
            } else {
                delayMinMs = min; delayMaxMs = max;
                localStorage.setItem('twdl_delayMinMs', String(min));
                localStorage.setItem('twdl_delayMaxMs', String(max));
                autoState.message = '下载间隔已设置为 ' + min + '–' + max + ' ms';
            }
            updateAutoPanel();
        };
        delayMinInput.addEventListener('change', saveDelayBounds);
        delayMaxInput.addEventListener('change', saveDelayBounds);
        updateAutoPanel();
    };

    const openSettingsModal = () => {
        if (document.getElementById('twdl-settings-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'twdl-settings-modal';

        const lang = getCurrentLanguage();
        const titleText = lang === 'ja' ? 'メディアダウンローダー設定' : 'Media Downloader Settings';

        modal.innerHTML = `
            <div id="twdl-settings-content">
                <div class="twdl-modal-header">
                    <span>${titleText}</span>
                    <div class="twdl-close-btn">&times;</div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; cursor: pointer; font-size: 15px;">
                        <input type="checkbox" id="twdl-sync-checkbox" ${enableDownloadHistorySync ? 'checked' : ''} style="margin: 0 12px 0 0; width: 18px; height: 18px;">
                        <span>${lang === 'ja' ? 'ブックマークを利用した履歴の同期を有効にする' : 'Enable online history sync using bookmarks'}</span>
                    </label>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; cursor: pointer; font-size: 15px;">
                        <input type="checkbox" id="twdl-downloadmode-checkbox" ${downloadMode === 'dataurl' ? 'checked' : ''} style="margin: 0 12px 0 0; width: 18px; height: 18px;">
                        <span>${lang === 'ja' ? 'iOSでData URL形式のダウンロードを強制する（旧仕様）' : 'Force Data URL download on iOS (Legacy)'}</span>
                    </label>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="font-size: 15px; font-weight: bold;">
                        ${lang === 'ja' ? '日時のフォーマット (dayjs形式)' : 'Date/Time Format (dayjs)'}
                    </label>
                    <input type="text" id="twdl-posttime-input" class="twdl-input-field" value="${postTimeFormat}">
                    <div style="font-size: 12px; color: #536471; margin-top: 6px; line-height: 1.4;">
                        ${lang === 'ja' ? '例: YYYYMMDD_HHmmss' : 'Ex: YYYYMMDD_HHmmss'}
                    </div>
                </div>

                <div style="margin-bottom: 24px;">
                    <label style="font-size: 15px; font-weight: bold;">
                        ${lang === 'ja' ? 'ファイル名のフォーマット' : 'Filename Format'}
                    </label>
                    <div style="display: flex; align-items: center; margin-top: 8px;">
                        <input type="text" id="twdl-filename-input" class="twdl-input-field" style="margin-top: 0; flex: 1;" value="${filenameFormat}">
                        <span style="margin-left: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; color: #536471;">.ext</span>
                    </div>
                    <div style="font-size: 12px; color: #536471; margin-top: 6px; line-height: 1.4;">
                        ${lang === 'ja' ? '変数: {userId}, {userName}, {postId}, {postTime}, {mediaType}, {index}' : 'Variables: {userId}, {userName}, {postId}, {postTime}, {mediaType}, {index}'}
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button id="twdl-export-btn" style="padding: 12px; background: #1DA1F2; color: white; border: none; border-radius: 9999px; font-size: 15px; font-weight: bold; cursor: pointer; transition: 0.2s; font-family: inherit;">
                        ${lang === 'ja' ? '履歴データをエクスポート' : 'Export History Data'}
                    </button>
                    <button id="twdl-import-btn" style="padding: 12px; background: transparent; border: 1px solid #1DA1F2; color: #1DA1F2; border-radius: 9999px; font-size: 15px; font-weight: bold; cursor: pointer; transition: 0.2s; font-family: inherit;">
                        ${lang === 'ja' ? '履歴データをインポート' : 'Import History Data'}
                    </button>
                    <input type="file" id="twdl-file-input" accept=".json" style="display: none;">
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.twdl-close-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#twdl-sync-checkbox').addEventListener('change', (e) => {
            enableDownloadHistorySync = e.target.checked;
            localStorage.setItem('twdl_enableSync', enableDownloadHistorySync);
        });

        modal.querySelector('#twdl-downloadmode-checkbox').addEventListener('change', (e) => {
            downloadMode = e.target.checked ? 'dataurl' : 'blob';
            localStorage.setItem('twdl_downloadMode', downloadMode);
        });

        modal.querySelector('#twdl-posttime-input').addEventListener('input', (e) => {
            postTimeFormat = e.target.value;
            localStorage.setItem('twdl_postTimeFormat', postTimeFormat);
        });

        modal.querySelector('#twdl-filename-input').addEventListener('input', (e) => {
            setFilenameTemplate(e.target.value);
        });

        modal.querySelector('#twdl-export-btn').addEventListener('click', async () => {
            try {
                const ids = await getDownloadedPostIdsIndexedDB();
                const blob = new Blob([JSON.stringify(ids)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `twdl_history_${dayjs().format('YYYYMMDD_HHmmss')}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error("Export Error:", err);
                alert(lang === 'ja' ? 'エクスポートに失敗しました' : 'Export failed');
            }
        });

        const fileInput = modal.querySelector('#twdl-file-input');
        modal.querySelector('#twdl-import-btn').addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedIds = JSON.parse(event.target.result);
                    if (!Array.isArray(importedIds)) throw new Error("Invalid JSON format");

                    const db = await openDB();
                    const transaction = db.transaction(STORE_NAME, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);

                    let addedCount = 0;
                    importedIds.forEach(id => {
                        if (!downloadedPostsCache.has(id)) {
                            store.put({ postId: id });
                            downloadedPostsCache.add(id);
                            addedCount++;
                        }
                    });

                    transaction.oncomplete = () => {
                        alert(lang === 'ja' ? `インポート完了: 新たに ${addedCount} 件の履歴を追加しました` : `Import Complete: Added ${addedCount} new records`);
                        fileInput.value = '';
                    };
                } catch (err) {
                    console.error("Import Error:", err);
                    alert(lang === 'ja' ? 'インポート失敗: 正しいJSONファイルを選択してください' : 'Import Failed: Please select a valid JSON file');
                }
            };
            reader.readAsText(file);
        });
    };

    const injectSettingsMenu = () => {
        if (!window.location.pathname.startsWith('/settings')) return;

        const helpCenterLink = document.querySelector('a[data-testid="helpCenterLink"]');
        if (!helpCenterLink) return;

        if (document.querySelector('a[data-testid="twdlSettingsLink"]')) return;

        const settingsLink = helpCenterLink.cloneNode(true);

        settingsLink.setAttribute('data-testid', 'twdlSettingsLink');
        settingsLink.href = "#";

        const textSpan = settingsLink.querySelector('span');
        if (textSpan) {
            textSpan.textContent = getCurrentLanguage() === 'ja' ? 'メディアダウンローダー設定' : 'Media Downloader Settings';
        }

        const svgIcon = settingsLink.querySelector('svg');
        if (svgIcon) {
            svgIcon.innerHTML = `<g><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.93,0-3.5-1.57-3.5-3.5 s1.57-3.5,3.5-3.5s3.5,1.57,3.5,3.5S13.93,15.6,12,15.6z" fill="currentColor"></path></g>`;
        }

        settingsLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSettingsModal();
        });

        const wrapperDiv = document.createElement('div');
        wrapperDiv.className = 'css-175oi2r';
        wrapperDiv.setAttribute('data-testid', 'activeRoute');
        wrapperDiv.appendChild(settingsLink);

        const parentDiv = helpCenterLink.parentElement;
        if (parentDiv) {
            parentDiv.insertBefore(wrapperDiv, helpCenterLink);
        }
    };

    const getNoImageMessage = () => {
        const lang = getCurrentLanguage();
        return lang === 'ja' ? "このツイートには画像または動画がありません！" : "There is no image or video in this tweet!";
    };

    const getAlreadyBookmarkedMessage = () => {
        const lang = getCurrentLanguage();
        if (lang === 'ja') {
            return window.confirm('この投稿は既にダウンロードされています。\nダウンロードを続行しますか？');
        } else {
            return window.confirm('This post is already downloaded.\nDo you want to continue downloading?');
        }
    };

    const status = (btn, css) => {
        btn.classList.remove('download', 'loading', 'failed', 'completed');
        if (css) btn.classList.add(css);
    };

    const getValidMediaElements = (cell) => {
        let validImages = [], validVideos = [], validGifs = [];

        validImages = Array.from(cell.querySelectorAll("img[src^='https://pbs.twimg.com/media/']"))
            .filter(img => (
                !img.closest("div[tabindex='0'][role='link']") &&
                !img.closest("div[data-testid='previewInterstitial']") &&
                !img.closest("div[data-testid='videoPlayer']")
            ));

        const videoCandidates_videoTag = Array.from(cell.querySelectorAll("video"));
        videoCandidates_videoTag.forEach(video => {
            if (video.closest("div[tabindex='0'][role='link']")) return;
            if (!video.closest("div[data-testid='videoPlayer']")) return;
            if (video.src?.startsWith("https://video.twimg.com/tweet_video")) {
                validGifs.push(video);
            } else if (video.poster?.includes("/ext_tw_video_thumb/") || video.poster?.includes("/amplify_tw_video_thumb/") || video.poster?.includes("/amplify_video_thumb/") || video.poster?.includes("/media/")) {
                validVideos.push(video);
            }
        });

        const videoCandidates_imgTag = Array.from(cell.querySelectorAll("img[src]"));
        videoCandidates_imgTag.forEach(img => {
            if (img.closest("div[tabindex='0'][role='link']")) return;
            if (!img.closest("div[data-testid='previewInterstitial']") && !img.closest("div[data-testid='videoPlayer']")) return;
            if (img.src.startsWith("https://pbs.twimg.com/tweet_video_thumb/")) {
                validGifs.push(img);
            } else if (img.src.includes("/ext_tw_video_thumb/") || img.src.includes("/amplify_tw_video_thumb/") || img.src.includes("/amplify_video_thumb/") || img.src.includes("/media/")) {
                validVideos.push(img);
            }
        });
        return { images: validImages, videos: validVideos, gifs: validGifs };
    };

    const getTweetFilenameElements = (url, cell) => {
        const match = url.match(/^https?:\/\/(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/);
        if (!match) return null;

        const userNameContainer = cell.querySelector("div[data-testid='User-Name'] div[dir='ltr'] span");
        const postTimeElement = cell.querySelector("article[data-testid='tweet'] time[datetime], time[datetime]");
        const tweetTextElement = cell.querySelector("[data-testid='tweetText']");
        const userName = normalizePostText(userNameContainer?.innerText || userNameContainer?.textContent || '');

        return {
            userId: match[1],
            userName: userName || 'unknown',
            postId: match[2],
            postTime: postTimeElement?.getAttribute('datetime') || 'unknown',
            postText: normalizePostText(tweetTextElement?.innerText || tweetTextElement?.textContent || '')
        };
    };

    const normalizeImageMediaURL = (source) => {
        if (!source) return '';
        if (/([?&])name=[^&]*/i.test(source)) return source.replace(/([?&])name=[^&]*/i, '$1name=orig');
        return source + (source.includes('?') ? '&' : '?') + 'name=orig';
    };

    const normalizeGifMediaURL = (source) => {
        if (!source) return '';
        if (source.startsWith('https://pbs.twimg.com/tweet_video_thumb/')) {
            const gifId = source.split('?')[0].split('/').pop();
            return 'https://video.twimg.com/tweet_video/' + gifId + '.mp4';
        }
        return source;
    };

    const getOrderedMediaItems = (cell) => {
        const mediaElems = getValidMediaElements(cell);
        const candidates = [
            ...mediaElems.images.map(element => ({ element, kind: 'img' })),
            ...mediaElems.gifs.map(element => ({ element, kind: 'gif' })),
            ...mediaElems.videos.map(element => ({ element, kind: 'video' }))
        ];
        const selected = [];
        const byContainer = new Map();
        const standaloneKeys = new Set();
        for (const candidate of candidates) {
            const container = candidate.element.closest("div[data-testid='videoPlayer']");
            if (container) {
                const previous = byContainer.get(container);
                if (!previous || (candidate.element.tagName === 'VIDEO' && previous.element.tagName !== 'VIDEO')) {
                    byContainer.set(container, candidate);
                }
                continue;
            }
            const source = candidate.element.currentSrc || candidate.element.src || candidate.element.poster || '';
            const key = candidate.kind + ':' + source;
            if (standaloneKeys.has(key)) continue;
            standaloneKeys.add(key);
            selected.push(candidate);
        }
        selected.push(...byContainer.values());
        selected.sort((left, right) => {
            if (left.element === right.element) return 0;
            const position = left.element.compareDocumentPosition(right.element);
            return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
        return selected.map((candidate, index) => {
            const source = candidate.element.currentSrc || candidate.element.src || candidate.element.poster || '';
            let url = '';
            let ext = 'jpg';
            if (candidate.kind === 'img') {
                url = normalizeImageMediaURL(source);
                ext = getMediaInfoFromUrl(url).ext;
            } else if (candidate.kind === 'gif') {
                url = normalizeGifMediaURL(source);
                ext = 'mp4';
            } else {
                ext = 'mp4';
            }
            return {
                type: candidate.kind,
                url: url || null,
                ext,
                index: index + 1
            };
        });
    };

    const extractHighestBitrateVideoURLs = (tweet_obj) => {
        const extEntities = tweet_obj?.extended_entities || tweet_obj?.legacy?.extended_entities;
        if (extEntities?.media) {
            return extEntities.media
                .filter(media => media.type === 'video' && media.video_info?.variants)
                .map(media => media.video_info.variants
                    .filter(variant => variant.content_type === 'video/mp4' && variant.url)
                    .sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0))[0]?.url)
                .filter(Boolean);
        }
        if (tweet_obj?.card?.legacy?.binding_values) {
            const unifiedCardBinding = tweet_obj.card.legacy.binding_values.find(bv => bv.key === 'unified_card');
            if (unifiedCardBinding?.value?.string_value) {
                try {
                    const unifiedCard = JSON.parse(unifiedCardBinding.value.string_value);
                    if (unifiedCard.media_entities) {
                        return Object.values(unifiedCard.media_entities)
                            .filter(media => media.type === 'video' && media.video_info?.variants)
                            .map(media => media.video_info.variants
                                .filter(variant => variant.content_type === 'video/mp4' && variant.url)
                                .sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0))[0]?.url)
                            .filter(Boolean);
                    }
                } catch (error) {
                    console.error('[TMD] unified_card JSON 解析失败:', error);
                }
            }
        }
        return [];
    };

    const resolveMediaItems = async (snapshot) => {
        const mediaItems = (snapshot.mediaItems || []).map(item => ({ ...item }));
        const videoIndexes = mediaItems
            .map((item, index) => item.type === 'video' && !item.url ? index : -1)
            .filter(index => index >= 0);
        if (videoIndexes.length === 0) return mediaItems;

        const tweetRes = await fetchTweetDetailWithGraphQL(snapshot.postId);
        if (!tweetRes?.data) throw new Error('Unable to read tweet media details.');
        const tweetResult = tweetRes.data.tweetResult?.result;
        const tweetObj = tweetResult?.tweet || tweetResult;
        const videoURLs = extractHighestBitrateVideoURLs(tweetObj);
        videoIndexes.forEach((itemIndex, videoIndex) => {
            mediaItems[itemIndex].url = videoURLs[videoIndex] || null;
            mediaItems[itemIndex].ext = 'mp4';
        });
        return mediaItems;
    };

    const createPostSnapshot = (cell) => {
        const tweetUrl = getMainTweetUrl(cell);
        const filenameElements = getTweetFilenameElements(tweetUrl, cell);
        if (!filenameElements) return null;
        return {
            postId: filenameElements.postId,
            tweetUrl,
            filenameElements: { ...filenameElements },
            mediaItems: getOrderedMediaItems(cell),
            queuedAt: Date.now(),
            button: cell.querySelector('.tmd-down') || null
        };
    };

    const getMediaURLs = async (cell, filenameElements) => {
        const mediaItems = await resolveMediaItems({
            postId: filenameElements.postId,
            mediaItems: getOrderedMediaItems(cell)
        });
        return {
            mediaItems,
            imageURLs: mediaItems.filter(item => item.type === 'img').map(item => item.url).filter(Boolean),
            gifURLs: mediaItems.filter(item => item.type === 'gif').map(item => item.url).filter(Boolean),
            videoURLs: mediaItems.filter(item => item.type === 'video').map(item => item.url).filter(Boolean)
        };
    };

    const checkBookmarkStatus = async (userId, postId, postTime) => {
        if (!enableDownloadHistorySync) return false;

        try {
            const bookmarkData = await fetchBookmarkSearchTimeline(userId, postTime);
            if (!bookmarkData.data) {
                console.log("ブックマーク状態の確認に失敗　APIなし");
                return false;
            }
            const instructions = bookmarkData.data.search_by_raw_query.bookmarks_search_timeline.timeline.instructions;
            if (!instructions) return false;

            for (const instruction of instructions) {
                if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                    for (const entry of instruction.entries) {
                        if (entry.entryId && entry.entryId === `tweet-${postId}`) {
                            return true;
                        }
                    }
                }
            }
            return false;
        } catch (error) {
            console.error("ブックマーク状態の確認に失敗:", error);
            return false;
        }
    };

    const clickBookmarkButton = (cell) => {
        if (!enableDownloadHistorySync) return;
        const btn_group = cell.querySelector('div[role="group"]:last-of-type, ul.tweet-actions, ul.tweet-detail-actions');
        if (btn_group) {
            const bookmarkButton = btn_group.querySelector('button[data-testid="bookmark"]');
            if (bookmarkButton) bookmarkButton.click();
        }
    };

    const waitForBookmarkStateChange = (cell) => {
        return new Promise(resolve => {
            if (!enableDownloadHistorySync && !isAppleMobile) {
                resolve();
                return;
            }
            const btn_group = cell.querySelector('div[role="group"]:last-of-type, ul.tweet-actions, ul.tweet-detail-actions');
            const bookmarkButton = btn_group ? btn_group.querySelector('button[data-testid="bookmark"]') : null;
            if (!bookmarkButton) {
                resolve();
                return;
            }
            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-testid') {
                        if (bookmarkButton.dataset.testid === 'removeBookmark') {
                            cleanup();
                            setTimeout(() => resolve(), 500);
                        }
                    }
                }
            });

            const timeoutId = setTimeout(() => {
                console.warn("waitForBookmarkStateChange: Timeout waiting for bookmark state change.");
                cleanup();
                resolve();
            }, 10000);

            const cleanup = () => {
                observer.disconnect();
                clearTimeout(timeoutId);
            };

            observer.observe(bookmarkButton, {
                attributes: true,
                attributeFilter: ['data-testid']
            });
        });
    };

    const blobToDataURL = (blob) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    };

    const hasNativeDownload = () => typeof GM_download === 'function';
    const nativeDownloadStallTimeout = 120000;

    const downloadUrlWithGMDownload = (mediaSrcURL, filename) => {
        if (!hasNativeDownload()) {
            return Promise.reject(new Error('GM_download API unavailable; using Blob fallback.'));
        }

        const safeFilename = sanitizeFilename(filename, 'media');
        console.log('[TMD] GM_download 入参:', { url: mediaSrcURL, name: safeFilename });

        return new Promise((resolve, reject) => {
            let settled = false;
            let watchdogId = null;
            let downloadHandle = null;
            const clearWatchdog = () => {
                if (watchdogId !== null) {
                    clearTimeout(watchdogId);
                    watchdogId = null;
                }
            };
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                clearWatchdog();
                callback(value);
            };
            const details = (value) => {
                if (!value) return '';
                if (typeof value === 'string') return value;
                try { return JSON.stringify(value); } catch (error) { return String(value); }
            };
            const armWatchdog = () => {
                if (settled) return;
                clearWatchdog();
                watchdogId = setTimeout(() => {
                    if (settled) return;
                    const error = new Error(`GM_download stalled for ${nativeDownloadStallTimeout / 1000} seconds. 文件名: ${safeFilename}`);
                    try {
                        if (downloadHandle && typeof downloadHandle.abort === 'function') downloadHandle.abort();
                    } catch (abortError) {
                        console.warn('[TMD] GM_download: 中止停滞任务失败:', abortError);
                    }
                    console.error('[TMD]', error.message);
                    finish(reject, error);
                }, nativeDownloadStallTimeout);
            };

            try {
                console.log(`[TMD] GM_download: 开始调用 Chrome 下载。文件名: ${safeFilename} URL: ${mediaSrcURL}`);
                downloadHandle = GM_download({
                    url: mediaSrcURL,
                    name: safeFilename,
                    saveAs: false,
                    conflictAction: 'uniquify',
                    onprogress: progress => {
                        armWatchdog();
                        const loaded = Number(progress?.loaded || 0);
                        const total = Number(progress?.total || 0);
                        if (total > 0) {
                            console.log(`[TMD] GM_download: 下载进度 ${(loaded / total * 100).toFixed(1)}%。文件名: ${safeFilename}`);
                        } else {
                            console.log(`[TMD] GM_download: 已接收 ${(loaded / 1024 / 1024).toFixed(2)} MB。文件名: ${safeFilename}`);
                        }
                    },
                    onload: () => {
                        console.log(`[TMD] GM_download: 下载完成。文件名: ${safeFilename}`);
                        finish(resolve);
                    },
                    onerror: error => {
                        const message = `GM_download failed: ${details(error) || 'unknown error'}`;
                        console.error(`[TMD] ${message} 文件名: ${safeFilename}`, error);
                        finish(reject, new Error(message));
                    },
                    ontimeout: () => {
                        const error = new Error(`GM_download timed out. 文件名: ${safeFilename}`);
                        console.error('[TMD]', error.message);
                        finish(reject, error);
                    },
                    onabort: () => {
                        const error = new Error(`GM_download aborted. 文件名: ${safeFilename}`);
                        console.warn('[TMD]', error.message);
                        finish(reject, error);
                    }
                });
                armWatchdog();
            } catch (error) {
                finish(reject, error);
            }
        });
    };

    const downloadZipArchive = async (blobs, filenameElements, mediaURLs, cell, bookmarkPromise) => {
        try {
            const files = {};
            const filenames = blobs.map((_, index) => {
                const mediaInfo = getMediaInfoFromUrl(mediaURLs[index]);
                return generateFilename(filenameElements, mediaInfo.typeLabel, index + 1, mediaInfo.ext, blobs.length);
            });
            const uint8Arrays = await Promise.all(blobs.map(async (blob) => {
                return await blobToUint8Array(blob);
            }));
            uint8Arrays.forEach((uint8Array, index) => {
                files[filenames[index]] = uint8Array;
            });

            const zipData = await new Promise((resolve, reject) => {
                fflate.zip(files, { level: 0 }, (err, zipData) => {
                    if (err) {
                        console.error("ZIP archive creation failed:", err);
                        reject(err);
                    } else {
                        resolve(zipData);
                    }
                });
            });

            const zipBlob = new Blob([zipData], { type: 'application/zip' });
            console.log(`[TMD] downloadZipArchive: ZIP生成完了。総サイズ: ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB`);
            const a = document.createElement("a");
            a.download = generateFilename(filenameElements, 'medias', '', 'zip', 1);

            if (enableDownloadHistorySync && isAppleMobile && bookmarkPromise) {
                clickBookmarkButton(cell);
                await bookmarkPromise;
            }

            if (isAppleMobile && downloadMode === 'dataurl') {
                const dataUrl = await blobToDataURL(zipBlob);
                a.href = dataUrl;
            } else {
                const blobUrl = URL.createObjectURL(zipBlob);
                a.href = blobUrl;
            }

            document.body.appendChild(a);
            a.click();
            a.remove();

            if (!isAppleMobile && a.href.startsWith('blob:')) {
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }
            console.log("[TMD] downloadZipArchive: ZIP処理がすべて完了しました。");
        } catch (error) {
            console.error("[TMD] downloadZipArchive: エラーが発生しました:", error);
            throw error;
        }
    };

    const downloadBlobAsFile = async (blob, filename, cell, bookmarkPromise) => {
        try {
            if (!(blob instanceof Blob) || blob.size <= 0) {
                throw new Error(`Invalid or empty Blob for ${filename}`);
            }
            const a = document.createElement("a");
            a.download = filename;
            let objectUrl = '';

            if (enableDownloadHistorySync && isAppleMobile && bookmarkPromise) {
                clickBookmarkButton(cell);
                await bookmarkPromise;
            }

            if (isAppleMobile && downloadMode === 'dataurl') {
                a.href = await blobToDataURL(blob);
            } else {
                objectUrl = URL.createObjectURL(blob);
                a.href = objectUrl;
            }

            console.log(`[TMD] downloadBlobAsFile: 开始触发浏览器下载。文件名: ${filename}, 大小: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
            document.body.appendChild(a);
            try {
                a.click();
            } catch (error) {
                throw new Error(`Browser download click failed for ${filename}: ${error.message}`);
            } finally {
                a.remove();
            }

            if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            console.log(`[TMD] downloadBlobAsFile: 浏览器下载触发完成。文件名: ${filename}`);
        } catch (error) {
            console.error("[TMD] downloadBlobAsFile: エラーが発生しました:", error);
            throw error;
        }
    };

    const blobToUint8Array = async (blob) => {
        const arrayBuffer = await blob.arrayBuffer();
        try {
            return new Uint8Array(structuredClone(arrayBuffer, { transfer: [arrayBuffer] }));
        } catch (e) {
            return new Uint8Array(arrayBuffer);
        }
    };

    const downloadMediaWithFetchStream = async (mediaSrcURL) => {
        const headers = { 'User-Agent': userAgent };
        console.log(`[TMD] downloadMediaWithFetchStream: フェッチ開始 URL: ${mediaSrcURL}`);
        try {
            const res = await gmFetch(mediaSrcURL, { headers, responseType: 'blob' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

            const originalBlob = await res.blob();
            console.log(`[TMD] downloadMediaWithFetchStream: フェッチ成功。ステータス: ${res.status}, オリジナルMIME: ${originalBlob.type}, サイズ: ${(originalBlob.size / 1024 / 1024).toFixed(2)} MB`);

            const mediaInfo = getMediaInfoFromUrl(mediaSrcURL);
            let inferredMimeType = '';
            switch (mediaInfo.ext.toLowerCase()) {
                case 'jpg': case 'jpeg': inferredMimeType = 'image/jpeg'; break;
                case 'png': inferredMimeType = 'image/png'; break;
                case 'gif': inferredMimeType = 'image/gif'; break;
                case 'mp4': inferredMimeType = 'video/mp4'; break;
                case 'webm': inferredMimeType = 'video/webm'; break;
                default: inferredMimeType = originalBlob.type || 'application/octet-stream'; break;
            }
            if (!originalBlob.type || originalBlob.type !== inferredMimeType) {
                return originalBlob.slice(0, originalBlob.size, inferredMimeType);
            }
            return originalBlob;
        } catch (error) {
            console.error(`[TMD] downloadMediaWithFetchStream: フェッチ中にエラーが発生しました URL: ${mediaSrcURL}`, error);
            return null;
        }
    };

    // Each call completes only after the local service has written the file.
    const downloadWithLocalService = async (mediaURL, filename) => {
        let response;
        try {
            response = await gmFetch('http://127.0.0.1:18765/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-TMD-Request': '1' },
                body: JSON.stringify({ url: mediaURL, filename }),
                timeout: 1800000
            });
        } catch (cause) {
            const error = new Error('无法连接本地下载器，或等待响应超时。请查看下载器窗口；超时后重试可能产生同名副本。');
            error.localServiceError = true;
            error.cause = cause;
            throw error;
        }
        let result;
        try { result = JSON.parse(await response.text()); }
        catch (_) {
            const error = new Error('本地下载器返回了无法识别的响应');
            error.localServiceError = true;
            throw error;
        }
        if (!response.ok || !result.ok) {
            const error = new Error('本地下载失败: ' + (result.error || ('HTTP ' + response.status)));
            error.localServiceError = true;
            throw error;
        }
        console.log('[TMD] 本地下载器已保存:', result.filename, '字节:', result.size);
        return result;
    };

    const downloadMedia = async (imageURLs, gifURLs, videoURLs, filenameElements, btn_down, allMediaURLs, cell, bookmarkPromise, options = {}) => {
        const {
            recordHistory = true,
            showCompleted = true,
            syncBookmark = true,
            mediaItems: suppliedMediaItems = null,
            localDownloader = false
        } = options;
        const orderedMediaItems = suppliedMediaItems
            ? suppliedMediaItems.map(item => ({ ...item }))
            : [
                ...imageURLs.map(url => ({ type: 'img', url })),
                ...gifURLs.map(url => ({ type: 'gif', url })),
                ...videoURLs.map(url => ({ type: 'video', url }))
            ];
        const mediaURLs = orderedMediaItems.map(item => item.url).filter(Boolean);
        const mediaCount = orderedMediaItems.length;
        if (mediaCount === 0) throw new Error('No media URLs found for this post.');
        if (mediaURLs.length !== mediaCount) throw new Error('Some media URLs could not be resolved for this post.');

        // 桌面端默认使用 Blob + <a download>，避免 GM_download 被扩展或服务器文件名接管。
        // 如需临时恢复 GM_download，可在控制台执行：localStorage.setItem('twdl_downloadMode', 'native')。
        const useNativeDesktopDownload = !isMobile && downloadMode === 'native' && hasNativeDownload();
        let localFailures = 0;
        if (localDownloader) {
            for (const [index, mediaURL] of mediaURLs.entries()) {
                const mediaInfo = getMediaInfoFromUrl(mediaURL);
                const filename = generateFilename(filenameElements, mediaInfo.typeLabel, index + 1, mediaInfo.ext, mediaCount);
                await waitForGlobalRandomClock('下载媒体:' + filename);
                try {
                    await downloadWithLocalService(mediaURL, filename);
                } catch (error) {
                    localFailures++;
                    const key = filenameElements.postId + ':' + index;
                    autoState.failedFiles.set(key, { postId: filenameElements.postId, url: mediaURL, filename, error: String(error.message || error) });
                    console.error('[TMD] 文件下载失败，继续下一个:', filename, error);
                }
            }
        } else if (useNativeDesktopDownload) {
            console.log('[TMD] downloadMedia: 使用 GM_download 直接交给 Chrome。媒体数量: ' + mediaCount);
            for (const [index, mediaURL] of mediaURLs.entries()) {
                const mediaInfo = getMediaInfoFromUrl(mediaURL);
                const filename = generateFilename(filenameElements, mediaInfo.typeLabel, index + 1, mediaInfo.ext, mediaCount);
                console.log('[TMD] 文件名生成结果:', { mode: filenameMode, elements: filenameElements, filename });
                await downloadUrlWithGMDownload(mediaURL, filename);
            }
        } else {
            console.log('[TMD] downloadMedia: 使用 Blob + <a download>，确保使用脚本生成的文件名。媒体数量: ' + mediaCount);
            const blobs = [];
            for (const mediaURL of mediaURLs) {
                const blob = await downloadMediaWithFetchStream(mediaURL);
                if (!blob) throw new Error('Media download failed: ' + mediaURL);
                blobs.push(blob);
            }

            if (mediaCount === 1) {
                const mediaInfo = getMediaInfoFromUrl(mediaURLs[0]);
                const filename = generateFilename(filenameElements, mediaInfo.typeLabel, 1, mediaInfo.ext, 1);
                await downloadBlobAsFile(blobs[0], filename, cell, syncBookmark ? (bookmarkPromise || Promise.resolve()) : null);
            } else if (isMobile) {
                await downloadZipArchive(blobs, filenameElements, mediaURLs, cell, syncBookmark ? (bookmarkPromise || Promise.resolve()) : null);
            } else {
                for (const [index, blob] of blobs.entries()) {
                    const mediaInfo = getMediaInfoFromUrl(mediaURLs[index]);
                    const filename = generateFilename(filenameElements, mediaInfo.typeLabel, index + 1, mediaInfo.ext, mediaCount);
                    await downloadBlobAsFile(blob, filename, cell, syncBookmark ? (bookmarkPromise || Promise.resolve()) : null);
                }
            }
        }

        if (localFailures) throw new Error('本帖有 ' + localFailures + ' 个文件下载失败，已记录到失败清单');
        if (recordHistory) {
            await markPostAsDownloadedIndexedDB(filenameElements.postId);
        } else {
            try {
                await removePostAsDownloadedIndexedDB(filenameElements.postId);
            } catch (error) {
                console.warn('[TMD] 自动下载完成后清理帖子历史失败:', error);
            }
        }
        if (btn_down) status(btn_down, showCompleted ? 'completed' : 'download');
        if (syncBookmark && enableDownloadHistorySync && !isAppleMobile && cell) clickBookmarkButton(cell);
        return { mediaCount };
    };

    const downloadPost = async (cellOrSnapshot, options = {}) => {
        const snapshot = options.snapshot || (cellOrSnapshot && Array.isArray(cellOrSnapshot.mediaItems) ? cellOrSnapshot : null);
        const cell = snapshot ? null : cellOrSnapshot;
        const mainTweetUrl = options.tweetUrl || snapshot?.tweetUrl || (cell ? getMainTweetUrl(cell) : '');
        const filenameElements = options.filenameElements || snapshot?.filenameElements || (cell ? getTweetFilenameElements(mainTweetUrl, cell) : null);
        if (!filenameElements) throw new Error('Unable to read tweet information.');

        const btn_down = options.button || snapshot?.button || cell?.querySelector('.tmd-down');
        const recordHistory = options.recordHistory ?? !options.auto;
        const showCompleted = options.showCompleted ?? !options.auto;
        const syncBookmark = options.syncBookmark ?? !options.auto;

        if (!options.auto && enableDownloadHistorySync) {
            const isAlreadyBookmarked = await checkBookmarkStatus(filenameElements.userId, filenameElements.postId, filenameElements.postTime);
            if (isAlreadyBookmarked && !getAlreadyBookmarkedMessage()) {
                if (btn_down) status(btn_down, 'completed');
                await markPostAsDownloadedIndexedDB(filenameElements.postId);
                return { skipped: true, postId: filenameElements.postId };
            }
        }

        const bookmarkPromise = syncBookmark && cell ? waitForBookmarkStateChange(cell) : null;
        let mediaData;
        if (snapshot) {
            const mediaItems = await resolveMediaItems(snapshot);
            mediaData = {
                mediaItems,
                imageURLs: mediaItems.filter(item => item.type === 'img').map(item => item.url).filter(Boolean),
                gifURLs: mediaItems.filter(item => item.type === 'gif').map(item => item.url).filter(Boolean),
                videoURLs: mediaItems.filter(item => item.type === 'video').map(item => item.url).filter(Boolean)
            };
        } else {
            mediaData = await getMediaURLs(cell, filenameElements);
        }
        const mediaURLs = mediaData.mediaItems.map(item => item.url).filter(Boolean);
        if (mediaURLs.length === 0) throw new Error('No image or video URL was found in this post.');

        return downloadMedia(mediaData.imageURLs, mediaData.gifURLs, mediaData.videoURLs, filenameElements, btn_down, mediaURLs, cell, bookmarkPromise, {
            recordHistory,
            showCompleted,
            syncBookmark,
            mediaItems: mediaData.mediaItems,
            localDownloader: !!options.auto
        });
    };

    const getVisibleTweetCells = () => Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'))
        .filter(cell => cell.querySelector('article[data-testid="tweet"]'));

    const getCurrentTweetCell = () => {
        const viewportCenter = (window.innerHeight || 800) / 2;
        const candidates = getVisibleTweetCells().map(cell => {
            const article = cell.querySelector('article[data-testid="tweet"]');
            const rect = article?.getBoundingClientRect();
            return rect ? { cell, distance: Math.abs((rect.top + rect.height / 2) - viewportCenter) } : null;
        }).filter(Boolean);
        candidates.sort((left, right) => left.distance - right.distance);
        return candidates[0]?.cell || null;
    };

    const enqueueVisiblePosts = () => {
        let addedCount = 0;
        const snapshots = getVisibleTweetCells().map(createPostSnapshot).filter(Boolean);
        let firstIndex = 0;
        if (autoState.startBoundaryPostId) {
            const boundaryIndex = snapshots.findIndex(snapshot => snapshot.postId === autoState.startBoundaryPostId);
            if (boundaryIndex < 0) {
                autoState.message = '等待当前帖子出现在页面中';
                updateAutoPanel();
                return 0;
            }
            for (const snapshot of snapshots.slice(0, boundaryIndex)) {
                if (snapshot.mediaItems.length > 0) autoState.seen.add(snapshot.postId);
            }
            firstIndex = boundaryIndex;
            autoState.startBoundaryPostId = null;
        }

        for (const snapshot of snapshots.slice(firstIndex)) {
            if (snapshot.mediaItems.length === 0) continue;
            const postId = snapshot.postId;
            if (autoState.seen.has(postId) || autoState.queued.has(postId) || autoState.active.has(postId) || autoState.failed.has(postId)) continue;
            if (autoState.queue.length >= MAX_AUTO_QUEUE_SIZE) {
                autoState.message = '队列已达到安全上限 ' + MAX_AUTO_QUEUE_SIZE + '，已暂停继续入队';
                break;
            }
            if (snapshot.button && downloadedPostsCache.has(postId)) status(snapshot.button, 'download');
            autoState.seen.add(postId);
            autoState.queue.push({ ...snapshot, queueSequence: ++autoState.queueSequence });
            autoState.queued.add(postId);
            addedCount++;
        }
        if (addedCount > 0) autoState.message = '发现 ' + addedCount + ' 个新帖子，已按顺序入队';
        updateAutoPanel();
        return addedCount;
    };

    const runAutoTask = async (item) => {
        autoState.active.add(item.postId);
        updateAutoPanel();
        try {
            try {
                await removePostAsDownloadedIndexedDB(item.postId);
            } catch (error) {
                console.warn('[TMD] 自动任务开始前清理旧下载记录失败:', error);
            }
            if (item.button) status(item.button, 'loading');
            const result = await downloadPost(item, {
                auto: true,
                snapshot: item,
                button: item.button,
                filenameElements: item.filenameElements,
                recordHistory: false,
                showCompleted: false,
                syncBookmark: false
            });
            if (result?.skipped) autoState.skipped++;
            else autoState.completed++;
            if (item.button) status(item.button, 'download');
            autoState.failed.delete(item.postId);
            autoState.failedItems.delete(item.postId);
        } catch (error) {
            autoState.failed.add(item.postId);
            if (!Array.from(autoState.failedFiles.values()).some(file => file.postId === item.postId)) autoState.failedItems.set(item.postId, item);
            autoState.message = '帖子 ' + item.postId + ' 下载失败：' + (error.message || error);
            autoState.message += '；继续处理其他帖子，可稍后点击重试失败';
            if (item.button) status(item.button, 'failed');
            console.error('[TMD] 自动下载失败 ' + item.postId + ':', error);
        } finally {
            autoState.active.delete(item.postId);
            updateAutoPanel();
        }
    };

    const scrollDownForAutoCycle = () => {
        if (!isAutoScrollEnabled()) return;
        const scrollRoot = document.scrollingElement || document.documentElement;
        const beforeY = window.scrollY || scrollRoot.scrollTop || 0;
        const viewportHeight = window.innerHeight || 800;
        const step = Math.max(viewportHeight * 0.85, 600);
        const maxY = Math.max(0, scrollRoot.scrollHeight - viewportHeight);
        const targetY = Math.min(maxY, beforeY + step);

        window.scrollTo({ top: targetY, behavior: 'auto' });
        scrollRoot.scrollTop = targetY;
        if (document.body) document.body.scrollTop = targetY;
        window.dispatchEvent(new Event('scroll'));

        if (targetY > beforeY + 2) {
            autoState.idleRounds = 0;
            autoState.message = '已滚动，等待下一轮扫描';
        } else {
            autoState.idleRounds++;
            autoState.message = '已到当前底部，等待新内容（第 ' + autoState.idleRounds + ' 轮）';
        }
        updateAutoPanel();
    };

    const runAutoCycle = () => {
        processArticles(false);
        const addedCount = enqueueVisiblePosts();
        if (addedCount > 0) autoState.message = '已记录 ' + addedCount + ' 个帖子，正在按全局时钟顺序下载';
        updateAutoPanel();
        return addedCount;
    };

    const finishAutoRunIfIdle = () => {
        if (!autoState.scanning && autoState.queue.length === 0 && autoState.active.size === 0) {
            autoState.running = false;
            autoState.paused = false;
            autoState.message = '队列已处理完成';
            updateAutoPanel();
        }
    };

    const runAutoQueueConsumer = async () => {
        try {
            await downloadedCacheReady;
            while (autoState.running || autoState.queue.length > 0) {
                if (autoState.paused) {
                    await sleep(250);
                    continue;
                }
                const item = autoState.queue.shift();
                if (item) {
                    autoState.queued.delete(item.postId);
                    await runAutoTask(item);
                    continue;
                }
                if (!autoState.scanning) break;
                await sleep(100);
            }
        } finally {
            autoState.consumerPromise = null;
            finishAutoRunIfIdle();
            updateAutoPanel();
        }
    };

    const runAutoScannerLoop = async () => {
        const waitForNextCycle = async () => {
            let remaining = getAutoIntervalMilliseconds();
            while (autoState.running && !autoState.paused && remaining > 0) {
                const waitTime = Math.min(250, remaining);
                await sleep(waitTime);
                remaining -= waitTime;
            }
        };

        try {
            await downloadedCacheReady;
            while (autoState.running) {
                if (autoState.paused) {
                    await sleep(250);
                    continue;
                }
                runAutoCycle();
                if (!isAutoScrollEnabled()) break;
                await waitForNextCycle();
                if (!autoState.running || autoState.paused) continue;
                scrollDownForAutoCycle();
                await sleep(500);
                if (autoState.idleRounds >= 5) {
                    runAutoCycle(); // capture any last DOM updates before stopping the scanner
                    autoState.message = '连续 5 轮未能继续滚动，停止轮询；正在处理剩余队列';
                    break;
                }
            }
            if (!isAutoScrollEnabled()) autoState.message = '本轮页面扫描完成，正在处理剩余队列';
        } finally {
            autoState.scanning = false;
            autoState.scannerPromise = null;
            finishAutoRunIfIdle();
            updateAutoPanel();
        }
    };

    const startAutoDownload = () => {
        if (autoState.running) {
            autoState.paused = false;
            updateAutoPanel();
            return autoState.runnerPromise;
        }
        if (autoState.queue.length === 0 && autoState.active.size === 0 && autoState.failedItems.size === 0) {
            autoState.seen.clear();
            autoState.failed.clear();
        }
        autoState.running = true;
        autoState.paused = false;
        autoState.scanning = true;
        autoState.idleRounds = 0;
        autoState.message = '正在扫描并按顺序入队';
        autoState.scannerPromise = runAutoScannerLoop();
        autoState.consumerPromise = runAutoQueueConsumer();
        autoState.runnerPromise = Promise.allSettled([autoState.scannerPromise, autoState.consumerPromise]);
        updateAutoPanel();
        return autoState.runnerPromise;
    };

    const stopAutoDownload = () => {
        autoState.running = false;
        autoState.scanning = false;
        autoState.paused = false;
        autoState.queue = [];
        autoState.queued.clear();
        autoState.startBoundaryPostId = null;
        autoState.message = '已停止，正在等待当前任务结束';
        updateAutoPanel();
    };

    const clearAutoQueue = () => {
        const idsToForget = new Set([...autoState.seen, ...autoState.queued, ...autoState.failedItems.keys()]);
        autoState.queue = [];
        autoState.queued.clear();
        autoState.failed.clear();
        autoState.failedItems.clear();
        autoState.failedFiles.clear();
        autoState.seen.clear();
        autoState.active.forEach(postId => autoState.seen.add(postId));
        autoState.startBoundaryPostId = null;
        Promise.all(Array.from(idsToForget).map(postId => removePostAsDownloadedIndexedDB(postId)))
            .catch(error => console.warn('[TMD] 清空自动队列时清理帖子历史失败:', error));
        autoState.message = '待处理队列和帖子 ID 缓存已清空';
        updateAutoPanel();
    };

    const listFailedDownloads = async () => {
        if (autoState.listingFailures) return;
        autoState.listingFailures = true;
        try {
            const files = Array.from(autoState.failedFiles.entries());
            const unresolved = Array.from(autoState.failedItems.values());
            if (!files.length && !unresolved.length) {
                autoState.message = '当前没有失败记录'; updateAutoPanel(); return;
            }
            // Send one entry per request to stay below the local service's request size limit.
            for (const [, file] of files) {
                try {
                    const response = await gmFetch('http://127.0.0.1:18765/failure', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TMD-Request': '1' },
                        body: JSON.stringify({ filename: file.filename, error: file.error }), timeout: 10000
                    });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                } catch (error) { console.error('[TMD] 无法向 Python 列出失败文件:', file.filename, error); }
            }
            for (const item of unresolved) {
                console.error('[TMD] 帖子媒体地址解析失败，无法交给浏览器下载:', item.postId, item.tweetUrl);
                try {
                    const response = await gmFetch('http://127.0.0.1:18765/failure', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TMD-Request': '1' },
                        body: JSON.stringify({ filename: '帖子 ' + item.postId + '（媒体地址未解析）', error: '无法获取媒体直链，无法交给浏览器' }), timeout: 10000
                    });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                } catch (error) { console.error('[TMD] 无法向 Python 列出失败帖子:', error); }
            }
            for (const [key, file] of files) {
                try {
                    await waitForGlobalRandomClock('浏览器下载失败文件:' + file.filename);
                    await downloadUrlWithGMDownload(file.url, file.filename);
                    if (autoState.failedFiles.get(key) === file) autoState.failedFiles.delete(key);
                    if (!Array.from(autoState.failedFiles.values()).some(entry => entry.postId === file.postId) && !autoState.failedItems.has(file.postId)) autoState.failed.delete(file.postId);
                } catch (error) { console.error('[TMD] 浏览器下载失败:', file.filename, error); }
                updateAutoPanel();
            }
            autoState.message = '失败清单已处理；未成功的记录保留，可再次点击列出失败';
            updateAutoPanel();
        } finally { autoState.listingFailures = false; }
    };

    const startFromCurrentPost = () => {
        const currentCell = getCurrentTweetCell();
        const currentSnapshot = currentCell ? createPostSnapshot(currentCell) : null;
        if (!currentSnapshot) {
            autoState.message = '没有找到当前视口中的帖子';
            updateAutoPanel();
            return;
        }
        autoState.queue = [];
        autoState.queued.clear();
        autoState.failed.clear();
        autoState.failedItems.clear();
        autoState.failedFiles.clear();
        autoState.seen.clear();
        autoState.active.forEach(postId => autoState.seen.add(postId));
        autoState.startBoundaryPostId = currentSnapshot.postId;
        autoState.message = '将从当前帖子 ' + currentSnapshot.postId + ' 开始';
        if (!autoState.running) {
            startAutoDownload();
        } else {
            autoState.paused = false;
            if (!autoState.scanning) {
                autoState.scanning = true;
                autoState.scannerPromise = runAutoScannerLoop();
            }
            runAutoCycle();
        }
        updateAutoPanel();
    };

    window.tmdStartFromCurrentPost = startFromCurrentPost;

    const createDownloadButton = async (cell) => {
        let btn_group = cell.querySelector('div[role="group"]:last-of-type, ul.tweet-actions, ul.tweet-detail-actions');
        if (!btn_group) return;
        let btn_share = Array.from(btn_group.querySelectorAll(':scope>div>div, li.tweet-action-item>a, li.tweet-detail-action-item>a')).pop()?.parentNode;
        if (!btn_share) return;

        let btn_bookmark = btn_share.previousElementSibling;
        let isBookmarked = false;
        if (enableDownloadHistorySync && btn_bookmark) {
            const bookmarkButtonTestId = btn_bookmark.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"]')?.dataset.testid;
            isBookmarked = bookmarkButtonTestId === 'removeBookmark';
        }

        let btn_down = btn_share.cloneNode(true);
        btn_down.classList.add('tmd-down', 'download');
        const btnElem = btn_down.querySelector('button');
        if (!btnElem) return;
        btnElem.setAttribute('aria-label', 'Download media');
        btnElem.title = 'Download media';
        btnElem.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" class="r-18jsvk2 r-4qtqp9 r-yyyyoo r-1xvli5t r-dnmrzs r-bnwqim r-1pl8vun r-lrvibr"><g class="download"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor" /></g><g class="loading"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="40 20" /></g><g class="failed"><circle cx="12" cy="12" r="11" fill="#f33" stroke="currentColor" stroke-width="2" opacity="0.8" /><path d="M14,5 a1,1 0 0 0 -4,0 l0.5,9.5 a1.5,1.5 0 0 0 3,0 z M12,17 a2,2 0 0 0 0,4 a2,2 0 0 0,0,-4" fill="#fff" stroke="none" /></g><g class="completed"><path d="M21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z M 7 10 l 3 4 q 1 1 2 0 l 8 -11 l -1.65 -1.2 l -7.35 10.1063 l -2.355 -3.14" fill="rgba(29, 161, 242, 1)" stroke="#1DA1F2" stroke-width="0.20" stroke-linecap="round" /></g></svg>';

        const filenameElements = getTweetFilenameElements(getMainTweetUrl(cell), cell);
        if (filenameElements) {
            if (downloadedPostsCache.has(filenameElements.postId)) {
                status(btn_down, 'completed');
            } else if (enableDownloadHistorySync && isBookmarked) {
                status(btn_down, 'completed');
                markPostAsDownloadedIndexedDB(filenameElements.postId);
            }
        }

        btn_down.onclick = async () => {
            if (btn_down.classList.contains('loading')) return;
            status(btn_down, 'loading');
            try {
                await downloadPost(cell, { auto: false, button: btn_down });
            } catch (error) {
                console.error('[TMD] 手动下载失败:', error);
                status(btn_down, 'failed');
                setTimeout(() => status(btn_down, 'download'), 3000);
                alert('下载失败：' + (error.message || error));
            }
        };
        if (btn_group) btn_group.insertBefore(btn_down, btn_share.nextSibling);
    };

    const processArticles = (enqueuePosts = autoState.running) => {
        injectSettingsMenu();
        injectAutoPanel();

        const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
        cells.forEach(cell => {
            const mainTweet = cell.querySelector('article[data-testid="tweet"]');
            if (!mainTweet) return;
            const tweetUrl = getMainTweetUrl(cell);
            if (!getTweetFilenameElements(tweetUrl, cell)) return;
            const mediaElems = getValidMediaElements(cell);
            const mediaCount = mediaElems.images.length + mediaElems.videos.length + mediaElems.gifs.length;
            if (!cell.querySelector('.tmd-down') && mediaCount > 0) createDownloadButton(cell);
        });

        let addedCount = 0;
        if (enqueuePosts) addedCount = enqueueVisiblePosts();
        updateAutoPanel();
        return addedCount;
    };

    let processTimeout = null;
    const debouncedProcessArticles = () => {
        clearTimeout(processTimeout);
        processTimeout = setTimeout(processArticles, 100);
    };

    const observer = new MutationObserver(debouncedProcessArticles);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('load', debouncedProcessArticles);
    window.addEventListener('popstate', debouncedProcessArticles);
    window.addEventListener('hashchange', debouncedProcessArticles);

})();


