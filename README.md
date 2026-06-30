#### Все что ниже делать не обязательно, вы можете сохранять информацию локально, загружая файлы json /// The steps below are optional; you can save the information locally by downloading the JSON files.




### 🇷🇺 Как пользоваться

1. Перейдите на [https://script.google.com](https://script.google.com)
2. Создайте новый проект.
3. Вставьте код, что ниже и сохраните его.
4. Нажмите **«Начать развертывание» (Deploy)**.
5. Выберите **«Веб-приложение» (Web App)**.
6. Настройте права доступа:

   * Выполнять от имени: **Меня**
   * Доступ: **Все**
7. Нажмите **«Развернуть»**.
8. Выдайте необходимые разрешения.
9. После развертывания Google выдаст **URL веб-приложения** — используйте в настройках проекта.

### Гайд на автозаполнение

1. Скачиваете расширение для браузера https://www.tampermonkey.net/
2. Создаете новый скрипт

                                               // ==UserScript==
                        // @name         Figure Tracker Universal Importer
                        // @namespace    figure-tracker-importer
                        // @version      2.1.0
                        // @description  Copy figure product data from AmiAmi, HobbySearch, Mandarake, Solaris, Good Smile Europe, OrzGK and other pages to Figure Tracker JSON format.
                        // @author       You
                        // @match        https://*.amiami.com/*
                        // @match        https://amiami.com/*
                        // @match        https://*.1999.co.jp/*
                        // @match        https://1999.co.jp/*
                        // @match        https://*.mandarake.co.jp/*
                        // @match        https://mandarake.co.jp/*
                        // @match        https://*.solarisjapan.com/*
                        // @match        https://solarisjapan.com/*
                        // @match        https://*.goodsmile.com/*
                        // @match        https://goodsmile.com/*
                        // @match        https://*.goodsmile-europe.com/*
                        // @match        https://goodsmile-europe.com/*
                        // @match        https://*.orzgk.com/*
                        // @match        https://orzgk.com/*
                        // @grant        GM_setClipboard
                        // ==/UserScript==
                        
                        (function () {
                            'use strict';
                        
                            const MONTHS = {
                                Jan: 'Январь',
                                Feb: 'Февраль',
                                Mar: 'Март',
                                Apr: 'Апрель',
                                May: 'Май',
                                Jun: 'Июнь',
                                Jul: 'Июль',
                                Aug: 'Август',
                                Sep: 'Сентябрь',
                                Oct: 'Октябрь',
                                Nov: 'Ноябрь',
                                Dec: 'Декабрь',
                                January: 'Январь',
                                February: 'Февраль',
                                March: 'Март',
                                April: 'Апрель',
                                May: 'Май',
                                June: 'Июнь',
                                July: 'Июль',
                                August: 'Август',
                                September: 'Сентябрь',
                                October: 'Октябрь',
                                November: 'Ноябрь',
                                December: 'Декабрь'
                            };
                        
                            const SITE_PROFILES = [
                                { id: 'amiami', name: 'AmiAmi', matches: host => host.includes('amiami.com'), parse: parseAmiAmi },
                                { id: 'hobbysearch', name: 'HobbySearch', matches: host => host.includes('1999.co.jp'), parse: parseHobbySearch },
                                { id: 'mandarake', name: 'Mandarake', matches: host => host.includes('mandarake.co.jp'), parse: parseMandarake },
                                { id: 'solaris', name: 'Solaris Japan', matches: host => host.includes('solarisjapan.com'), parse: parseSolaris },
                                { id: 'goodsmile-europe', name: 'Good Smile Europe', matches: host => host.includes('goodsmile-europe.com'), parse: parseGoodSmileEurope },
                                { id: 'goodsmile', name: 'Good Smile', matches: host => host.includes('goodsmile.com'), parse: parseGoodSmile },
                                { id: 'orzgk', name: 'OrzGK', matches: host => host.includes('orzgk.com'), parse: parseOrzGK }
                            ];
                        
                        
                            function normalizeReleaseDate(value) {
                                const raw = cleanText(value);
                                if (!raw) return '';
                        
                                const yearMonth = raw.match(/\b(20\d{2})[\/.-](0?[1-9]|1[0-2])\b/);
                                if (yearMonth) {
                                    return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;
                                }
                        
                                const quarter1 = raw.match(/\b(20\d{2})\s*Q([1-4])\b/i);
                                if (quarter1) return `${quarter1[1]} Q${quarter1[2]}`;
                        
                                const quarter2 = raw.match(/\bQ([1-4])\s*(20\d{2})\b/i);
                                if (quarter2) return `${quarter2[2]} Q${quarter2[1]}`;
                        
                                const monthYear = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?[\s,-]+(20\d{2})\b/i);
                                if (monthYear) return `${monthYear[1]} ${monthYear[2]}`;
                        
                                return raw;
                            }
                        
                            function findReleaseDateInPage() {
                                const bodyText = cleanText(document.body ? document.body.innerText : '');
                        
                                const patterns = [
                                    /Est\.?\s*Released\s*Time[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Estimated\s*Released\s*Time[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Est\.?\s*Release\s*Time[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Released\s*Time[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Release\s*Time[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Release\s*Date[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Est\.?\s*Release[\s:：-]{0,30}([^\n\r]+)/i,
                                    /Estimated\s*Release[\s:：-]{0,30}([^\n\r]+)/i
                                ];
                        
                                for (const pattern of patterns) {
                                    const match = bodyText.match(pattern);
                                    if (!match) continue;
                        
                                    const normalized = normalizeReleaseDate(match[1]);
                                    if (normalized) return normalized;
                                }
                        
                                const labelValue = findLabelValue([
                                    'Est Released Time',
                                    'Estimated Released Time',
                                    'Est Release Time',
                                    'Released Time',
                                    'Release Time',
                                    'Release Date',
                                    'Est. Release',
                                    'Estimated Release',
                                    'Release'
                                ]);
                        
                                return normalizeReleaseDate(labelValue);
                            }
                        
                            function findGoodSmileReleaseDate() {
                                const candidates = [];
                        
                                // Самое точное место на goodsmile.com
                                document.querySelectorAll(
                                    '.b-product-info__note, .b-product-info__status, #status-text-block, .p-product__infomation'
                                ).forEach(el => {
                                    const value = cleanText(el.textContent || '');
                                    if (value) candidates.push(value);
                                });
                        
                                // fallback по всей странице
                                candidates.push(cleanText(document.body ? document.body.innerText : ''));
                        
                                for (const textValue of candidates) {
                                    // Shipping 08/2027
                                    const shippingMonthYear = textValue.match(/\bShipping\s+(\d{1,2})[\/.-](20\d{2})\b/i);
                                    if (shippingMonthYear) {
                                        return `${shippingMonthYear[2]}-${String(shippingMonthYear[1]).padStart(2, '0')}`;
                                    }
                        
                                    // Shipping 2027/08
                                    const shippingYearMonth = textValue.match(/\bShipping\s+(20\d{2})[\/.-](\d{1,2})\b/i);
                                    if (shippingYearMonth) {
                                        return `${shippingYearMonth[1]}-${String(shippingYearMonth[2]).padStart(2, '0')}`;
                                    }
                        
                                    // Release 08/2027
                                    const releaseMonthYear = textValue.match(/\b(?:Release|Released|Release Date|Shipping)\s+(\d{1,2})[\/.-](20\d{2})\b/i);
                                    if (releaseMonthYear) {
                                        return `${releaseMonthYear[2]}-${String(releaseMonthYear[1]).padStart(2, '0')}`;
                                    }
                                }
                        
                                return '';
                            }
                        
                        function findDefinitionValue(labelNames) {
                          const wanted = labelNames.map(v => String(v).toLowerCase());
                        
                          const dts = Array.from(document.querySelectorAll('dt'));
                        
                          for (const dt of dts) {
                            const label = cleanText(dt.textContent || '').toLowerCase();
                        
                            if (!wanted.some(w => label === w || label.includes(w))) continue;
                        
                            let next = dt.nextElementSibling;
                        
                            while (next && next.tagName && next.tagName.toLowerCase() !== 'dd') {
                              next = next.nextElementSibling;
                            }
                        
                            if (next) {
                              const value = cleanText(next.textContent || '');
                              if (value) return value;
                            }
                          }
                        
                          return '';
                        }
                        
                        
                            function normalizeReleaseDate(value) {
                          const raw = cleanText(value);
                          if (!raw) return '';
                        
                          // Late October 2027 / Early March 2027 / Mid July 2027
                          const monthYearWithPart = raw.match(
                            /\b(?:Early|Mid|Late|End of|Beginning of)?\s*(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?[\s,-]+(20\d{2})\b/i
                          );
                        
                          if (monthYearWithPart) {
                            return `${monthYearWithPart[1]} ${monthYearWithPart[2]}`;
                          }
                        
                          // 2027/10 или 2027-10
                          const yearMonth = raw.match(/\b(20\d{2})[\/.-](0?[1-9]|1[0-2])\b/);
                          if (yearMonth) {
                            return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;
                          }
                        
                          // 10/2027 или 10-2027
                          const monthYearNumber = raw.match(/\b(0?[1-9]|1[0-2])[\/.-](20\d{2})\b/);
                          if (monthYearNumber) {
                            return `${monthYearNumber[2]}-${String(monthYearNumber[1]).padStart(2, '0')}`;
                          }
                        
                          // 2027 Q3
                          const quarter1 = raw.match(/\b(20\d{2})\s*Q([1-4])\b/i);
                          if (quarter1) return `${quarter1[1]} Q${quarter1[2]}`;
                        
                          // Q3 2027
                          const quarter2 = raw.match(/\bQ([1-4])\s*(20\d{2})\b/i);
                          if (quarter2) return `${quarter2[2]} Q${quarter2[1]}`;
                        
                          return raw;
                        }
                        
                        
                            function findGoodSmileEuropeReleaseDate() {
                          const definitionValue = findDefinitionValue([
                            'Release',
                            'Release Date',
                            'Released',
                            'Shipping'
                          ]);
                        
                          const normalizedDefinition = normalizeReleaseDate(definitionValue);
                          if (normalizedDefinition) return normalizedDefinition;
                        
                          const labelValue = findLabelValue([
                            'Release',
                            'Release Date',
                            'Released',
                            'Shipping'
                          ]);
                        
                          const normalizedLabel = normalizeReleaseDate(labelValue);
                          if (normalizedLabel) return normalizedLabel;
                        
                          const bodyText = cleanText(document.body ? document.body.innerText : '');
                        
                          const match = bodyText.match(
                            /\bRelease\s+((?:Early|Mid|Late|End of|Beginning of)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+20\d{2}|20\d{2}[\/.-](?:0?[1-9]|1[0-2])|(?:0?[1-9]|1[0-2])[\/.-]20\d{2})/i
                          );
                        
                          if (match) {
                            return normalizeReleaseDate(match[1]);
                          }
                        
                          return '';
                        }
                        
                            function text(selector, root = document) {
                                const el = root.querySelector(selector);
                                return el ? cleanText(el.innerText || el.textContent) : '';
                            }
                        
                            function attr(selector, attribute, root = document) {
                                const el = root.querySelector(selector);
                                return el ? el.getAttribute(attribute) || '' : '';
                            }
                        
                            function cleanText(value) {
                                return String(value || '')
                                    .replace(/&nbsp;/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                            }
                        
                            function normalizeJan(value) {
                                const digits = String(value || '').replace(/\D/g, '');
                                return digits.length >= 8 && digits.length <= 14 ? digits : '';
                            }
                        
                            function normalizeJanList(value) {
                                const raw = String(value || '');
                                const matches = raw.match(/\d[\d\s-]{6,20}\d/g) || [];
                        
                                return unique(
                                    matches
                                    .map(v => normalizeJan(v))
                                    .filter(v => v.length >= 8 && v.length <= 14)
                                );
                            }
                        
                            function getFirstJan(...values) {
                                for (const value of values) {
                                    const list = normalizeJanList(value);
                                    if (list.length) return list[0];
                                }
                        
                                return '';
                            }
                        
                            function findJanInPage() {
                                const candidates = [];
                        
                                // 1. Сначала ищем рядом с явными JAN/EAN/Barcode/GTIN labels
                                const labelValue = findLabelValue([
                                    'JAN code',
                                    'JAN',
                                    'EAN',
                                    'Barcode',
                                    'Bar code',
                                    'GTIN',
                                    'Product code',
                                    'Product Code'
                                ]);
                        
                                if (labelValue) candidates.push(labelValue);
                        
                                // 2. Meta / title / structured snippets
                                candidates.push(
                                    getMeta('product:retailer_item_id'),
                                    getMeta('product:gtin'),
                                    getMeta('product:gtin13'),
                                    getMeta('product:gtin14'),
                                    getMeta('og:title'),
                                    document.title
                                );
                        
                                // 3. Картинки часто содержат JAN в filename / alt / title
                                document.querySelectorAll('img').forEach(img => {
                                    candidates.push(
                                        img.getAttribute('alt'),
                                        img.getAttribute('title'),
                                        img.getAttribute('src'),
                                        img.getAttribute('data-src'),
                                        img.getAttribute('data-original'),
                                        img.getAttribute('data-large_image')
                                    );
                                });
                        
                                // 4. WooCommerce variations часто содержат JAN внутри JSON в attribute/image/title/src
                                document.querySelectorAll('[data-product_variations]').forEach(el => {
                                    candidates.push(el.getAttribute('data-product_variations'));
                                });
                        
                                // 5. Небольшой fallback по тексту страницы, но только около слов JAN/EAN/Barcode/GTIN
                                const bodyText = cleanText(document.body?.innerText || '');
                                const nearJan = bodyText.match(/(?:JAN|EAN|Barcode|Bar code|GTIN|Product Code)[\s:：-]{0,20}([0-9][0-9\s/-]{6,30}[0-9])/i);
                                if (nearJan) candidates.push(nearJan[1]);
                        
                                return getFirstJan(...candidates);
                            }
                        
                            function cleanPrice(value) {
                                const raw = String(value || '').trim();
                                if (!raw) return '0';
                        
                                const currency = detectCurrency(raw);
                        
                                // JPY почти всегда без копеек/центов, поэтому любые точки/запятые считаем разделителями тысяч
                                if (currency === 'JPY' || raw.includes('JPY') || raw.includes('¥') || raw.includes('円')) {
                                    const yen = raw.replace(/\D/g, '');
                                    return yen || '0';
                                }
                        
                                let number = raw
                                .replace(/[^\d.,]/g, '')
                                .trim();
                        
                                if (!number) return '0';
                        
                                const hasComma = number.includes(',');
                                const hasDot = number.includes('.');
                        
                                // Пример: 1,234.56 -> 1234.56
                                if (hasComma && hasDot) {
                                    const lastComma = number.lastIndexOf(',');
                                    const lastDot = number.lastIndexOf('.');
                        
                                    if (lastDot > lastComma) {
                                        number = number.replace(/,/g, '');
                                    } else {
                                        number = number.replace(/\./g, '').replace(',', '.');
                                    }
                        
                                    return number || '0';
                                }
                        
                                // Пример: 1,234 -> 1234, но 55,58 -> 55.58
                                if (hasComma) {
                                    const parts = number.split(',');
                                    const last = parts[parts.length - 1];
                        
                                    if (last.length === 3 && parts.length >= 2) {
                                        return number.replace(/,/g, '') || '0';
                                    }
                        
                                    return number.replace(',', '.') || '0';
                                }
                        
                                // Пример: 17.080 -> 17080, но 55.58 -> 55.58
                                if (hasDot) {
                                    const parts = number.split('.');
                                    const last = parts[parts.length - 1];
                        
                                    if (last.length === 3 && parts.length >= 2) {
                                        return number.replace(/\./g, '') || '0';
                                    }
                        
                                    return number || '0';
                                }
                        
                                return number || '0';
                            }
                        
                            function detectCurrency(value) {
                                const raw = String(value || '').toUpperCase();
                                if (raw.includes('JPY') || raw.includes('¥') || raw.includes('円')) return 'JPY';
                                if (raw.includes('USD') || raw.includes('$')) return 'USD';
                                if (raw.includes('EUR') || raw.includes('€')) return 'EUR';
                                if (raw.includes('GBP') || raw.includes('£')) return 'GBP';
                                return '';
                            }
                        
                            function absoluteUrl(url) {
                                if (!url) return '';
                                try {
                                    return new URL(String(url), window.location.href).href;
                                } catch {
                                    return String(url || '');
                                }
                            }
                        
                            function unique(arr) {
                                return [...new Set((arr || []).map(v => cleanText(v)).filter(Boolean))];
                            }
                        
                            function stripSiteSuffix(value) {
                                return cleanText(value)
                                    .replace(/\s*[|—-]\s*Solaris Japan\s*$/i, '')
                                    .replace(/\s*[|—-]\s*Figuya\s*[|—-]\s*Good Smile Europe\s*$/i, '')
                                    .replace(/\s*[|—-]\s*Good Smile Europe\s*$/i, '')
                                    .replace(/\s*[|—-]\s*OrzGK\s*$/i, '')
                                    .replace(/\s*\|\s*HobbySearch\s*$/i, '')
                                    .trim();
                            }
                        
                            function getMeta(nameOrProperty) {
                                const el = document.querySelector(
                                    `meta[property="${cssEscape(nameOrProperty)}"], meta[name="${cssEscape(nameOrProperty)}"]`
                            );
                                return el ? el.content || '' : '';
                            }
                        
                            function getAllMeta(nameOrProperty) {
                                return Array.from(document.querySelectorAll(
                                    `meta[property="${cssEscape(nameOrProperty)}"], meta[name="${cssEscape(nameOrProperty)}"]`
                            )).map(el => el.content || '').filter(Boolean);
                            }
                        
                            function cssEscape(value) {
                                if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
                                return String(value).replace(/"/g, '\\"');
                            }
                        
                            function getCanonicalUrl() {
                                return attr('link[rel="canonical"]', 'href') || getMeta('og:url') || window.location.href;
                            }
                        
                            function getBestImage(selectors = []) {
                                for (const selector of selectors) {
                                    const value = attr(selector, 'src') || attr(selector, 'data-src') || attr(selector, 'data-original') || attr(selector, 'data-zoom-image');
                                    if (value) return absoluteUrl(value);
                                }
                        
                                const secureOg = getMeta('og:image:secure_url');
                                if (secureOg) return absoluteUrl(secureOg);
                        
                                const ogImage = getMeta('og:image');
                                if (ogImage) return absoluteUrl(ogImage);
                        
                                const img = document.querySelector('main img, [class*="product"] img, img');
                                return img ? absoluteUrl(img.currentSrc || img.src || img.getAttribute('src')) : '';
                            }
                        
                            function collectImagesFromMeta() {
                                return unique([
                                    ...getAllMeta('og:image:secure_url'),
                                    ...getAllMeta('og:image')
                                ].map(absoluteUrl));
                            }
                        
                            function collectImagesFromSelectors(selectors = []) {
                                const images = [];
                        
                                for (const selector of selectors) {
                                    document.querySelectorAll(selector).forEach(img => {
                                        const src = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
                                        if (src && !String(src).startsWith('data:')) images.push(absoluteUrl(src));
                                    });
                                }
                        
                                return unique(images);
                            }
                        
                            function splitReleaseDate(value) {
                                const raw = cleanText(value);
                                if (!raw) return { releaseDate: '', month: '', year: '' };
                        
                                const amiamiMatch = raw.match(/^([A-Za-z]{3,9})[-\s/]+(\d{4})$/);
                                if (amiamiMatch) {
                                    const monthRaw = amiamiMatch[1];
                                    const year = amiamiMatch[2];
                                    return { releaseDate: raw, month: MONTHS[monthRaw] || monthRaw, year };
                                }
                        
                                const yearMonthMatch = raw.match(/(\d{4})[-/.年\s]+(\d{1,2})/);
                                if (yearMonthMatch) {
                                    const year = yearMonthMatch[1];
                                    const monthNumber = Number(yearMonthMatch[2]);
                                    const ruMonths = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
                                    return { releaseDate: raw, month: ruMonths[monthNumber] || '', year };
                                }
                        
                                const monthYearMatch = raw.match(/([A-Za-z]{3,9})\s+(\d{4})/);
                                if (monthYearMatch) {
                                    const monthRaw = monthYearMatch[1];
                                    const year = monthYearMatch[2];
                                    return { releaseDate: raw, month: MONTHS[monthRaw] || monthRaw, year };
                                }
                        
                                const yearOnly = raw.match(/(\d{4})/);
                                return { releaseDate: raw, month: '', year: yearOnly ? yearOnly[1] : '' };
                            }
                        
                            function findLabelValue(labelNames) {
                                const wanted = labelNames.map(v => String(v).toLowerCase());
                                const rows = Array.from(document.querySelectorAll('tr, dl, .item-about__data, .item-about__data-row, li, div'));
                        
                                for (const row of rows) {
                                    const rowText = cleanText(row.innerText || row.textContent);
                                    if (!rowText || rowText.length > 400) continue;
                                    const lower = rowText.toLowerCase();
                        
                                    for (const label of wanted) {
                                        if (lower.includes(label)) {
                                            const parts = rowText
                                            .replace(/：/g, ':')
                                            .split(':')
                                            .map(cleanText)
                                            .filter(Boolean);
                        
                                            if (parts.length >= 2) return parts.slice(1).join(': ');
                                        }
                                    }
                                }
                        
                                return '';
                            }
                        
                            function getJsonLdObjects() {
                                const found = [];
                        
                                function walk(value) {
                                    if (!value) return;
                        
                                    if (Array.isArray(value)) {
                                        value.forEach(walk);
                                        return;
                                    }
                        
                                    if (typeof value !== 'object') return;
                        
                                    found.push(value);
                        
                                    if (Array.isArray(value['@graph'])) value['@graph'].forEach(walk);
                                    if (value.mainEntity) walk(value.mainEntity);
                                    if (value.itemListElement) walk(value.itemListElement);
                                    if (value.item) walk(value.item);
                                }
                        
                                document.querySelectorAll('script[type="application/ld+json"], script[type="application/json+ld"]').forEach(script => {
                                    const raw = script.textContent || '';
                                    if (!raw.trim()) return;
                        
                                    try {
                                        walk(JSON.parse(raw));
                                    } catch (error) {
                                        // Some shops embed invalid JSON-LD. Ignore and use meta/DOM fallback.
                                    }
                                });
                        
                                return found;
                            }
                        
                            function hasType(obj, typeName) {
                                const type = obj && obj['@type'];
                                if (Array.isArray(type)) return type.map(String).some(t => t.toLowerCase() === typeName.toLowerCase());
                                return String(type || '').toLowerCase() === typeName.toLowerCase();
                            }
                        
                            function findJsonLdProduct() {
                                return getJsonLdObjects().find(obj => hasType(obj, 'Product')) || null;
                            }
                        
                            function asArray(value) {
                                if (!value) return [];
                                return Array.isArray(value) ? value : [value];
                            }
                        
                            function getNamedValue(value) {
                                if (!value) return '';
                                if (typeof value === 'string') return cleanText(value);
                                if (typeof value === 'object') return cleanText(value.name || value['@id'] || value.url || '');
                                return cleanText(value);
                            }
                        
                            function getOffer(product) {
                                const offers = asArray(product && product.offers).filter(Boolean);
                                if (!offers.length) return {};
                        
                                const notOut = offers.find(o => !/outofstock/i.test(String(o.availability || '')));
                                const newCondition = offers.find(o => /newcondition/i.test(String(o.itemCondition || '')));
                                return newCondition || notOut || offers[0] || {};
                            }
                        
                            function looksLikeJan(value) {
                                const digits = String(value || '').replace(/\D/g, '');
                                return digits.length >= 8 && digits.length <= 14 ? digits : '';
                            }
                        
                            function extractCodeFromUrl(url = window.location.href) {
                                const raw = String(url || '');
                                const amiami = raw.match(/[?&]scode=([^&]+)/i);
                                if (amiami) return decodeURIComponent(amiami[1]);
                        
                                const hobby = raw.match(/\/eng\/(\d+)/i);
                                if (hobby) return hobby[1];
                        
                                return '';
                            }
                        
                            function extractFromJsonLdProduct(product) {
                                if (!product) return {};
                                const jan = getFirstJan(
                                    product.gtin13,
                                    product.gtin14,
                                    product.gtin12,
                                    product.gtin,
                                    product.sku,
                                    product.mpn,
                                    product.productID
                                );
                                const offer = getOffer(product);
                                const images = unique(asArray(product.image).map(img => {
                                    if (typeof img === 'string') return absoluteUrl(img);
                                    if (img && typeof img === 'object') return absoluteUrl(img.url || img.contentUrl || '');
                                    return '';
                                }));
                        
                                const sku = cleanText(product.sku || offer.sku || '');
                                const mpn = cleanText(product.mpn || '');
                                const productID = cleanText(product.productID || product.productId || '');
                                const gtin = cleanText(product.gtin13 || product.gtin14 || product.gtin12 || product.gtin || '');
                        
                                return {
                                    name: cleanText(product.name || ''),
                                    price: cleanPrice(offer.price || product.price || ''),
                                    currency: cleanText(offer.priceCurrency || product.priceCurrency || ''),
                                    brand: getNamedValue(product.brand),
                                    maker: getNamedValue(product.manufacturer) || getNamedValue(product.brand),
                                    manufacturer: getNamedValue(product.manufacturer) || getNamedValue(product.brand),
                                    releaseDate: cleanText(product.releaseDate || product.datePublished || ''),
                                    imageUrl: images[0] || '',
                                    img: images[0] || '',
                                    images,
                                    url: absoluteUrl(product.url || offer.url || getCanonicalUrl()),
                                    sourceUrl: absoluteUrl(product.url || offer.url || getCanonicalUrl()),
                                    sku,
                                    mpn,
                                    jan,
                                    code: cleanText(product.sku || product.mpn || product.productID || ''),
                                    raw: {
                                        jsonLd: {
                                            name: product.name || '',
                                            sku,
                                            mpn,
                                            gtin,
                                            productID,
                                            brand: getNamedValue(product.brand),
                                            manufacturer: getNamedValue(product.manufacturer),
                                            price: offer.price || '',
                                            currency: offer.priceCurrency || ''
                                        }
                                    }
                                };
                            }
                        
                            function extractFromMeta() {
                                const title = getMeta('og:title') || document.title || '';
                                const images = collectImagesFromMeta();
                        
                                return {
                                    name: stripSiteSuffix(title),
                                    price: cleanPrice(getMeta('product:price:amount') || getMeta('og:price:amount') || getMeta('twitter:data1') || ''),
                                    currency: cleanText(getMeta('product:price:currency') || getMeta('og:price:currency') || ''),
                                    imageUrl: images[0] || '',
                                    img: images[0] || '',
                                    images,
                                    url: absoluteUrl(getMeta('og:url') || getCanonicalUrl()),
                                    sourceUrl: absoluteUrl(getMeta('og:url') || getCanonicalUrl())
                                };
                            }
                        
                            function mergeData(...objects) {
                                const out = {};
                                for (const obj of objects) {
                                    if (!obj) continue;
                                    for (const [key, value] of Object.entries(obj)) {
                                        if (key === 'images') {
                                            out.images = unique([...(out.images || []), ...asArray(value)]);
                                        } else if (key === 'raw') {
                                            out.raw = Object.assign({}, out.raw || {}, value || {});
                                        } else if ((out[key] == null || out[key] === '' || (Array.isArray(out[key]) && !out[key].length)) && value != null && value !== '') {
                                            out[key] = value;
                                        }
                                    }
                                }
                                return out;
                            }
                        
                            function isSuspiciousManufacturer(value) {
                                const raw = cleanText(value);
                                if (!raw) return false;
                                if (raw.length > 80) return true;
                                return /categories|login sign up|search by category|view all|model train|military model|pvc figure|anime robot/i.test(raw);
                            }
                        
                            function normalizeManufacturer(value, fallback = '') {
                                const raw = cleanText(value);
                                if (!raw || isSuspiciousManufacturer(raw)) return cleanText(fallback);
                                return raw;
                            }
                        
                            function normalizeItem(raw, sourceId, sourceName) {
                                const release = splitReleaseDate(raw.releaseDate);
                                const jan = normalizeJan(raw.jan || raw.JAN) || findJanInPage();
                        
                                return {
                                    name: raw.name || '',
                                    price: cleanPrice(raw.price),
                                    currency: raw.currency || detectCurrency(raw.price),
                                    brand: raw.brand || raw.maker || '',
                                    maker: raw.maker || raw.brand || '',
                                    manufacturer: raw.manufacturer || raw.maker || raw.brand || '',
                                    releaseDate: release.releaseDate,
                                    month: release.month,
                                    year: release.year,
                                    img: absoluteUrl(raw.img || raw.imageUrl || ''),
                                    imageUrl: absoluteUrl(raw.imageUrl || raw.img || ''),
                                    images: raw.images || [],
                                    url: raw.url || window.location.href,
                                    sourceUrl: raw.sourceUrl || window.location.href,
                                    store: raw.store || sourceName,
                                    source: sourceId,
                                    jan,
                                    code: raw.code || raw.amiamiCode || raw.productCode || raw.sku || raw.mpn || '',
                                    sku: raw.sku || '',
                                    category: raw.category || '',
                                    scale: raw.scale || '',
                                    raw
                                };
                            }
                        
                            function makePayload(profile, items) {
                                return {
                                    app: 'FigureTracker',
                                    source: profile.id,
                                    sourceName: profile.name,
                                    version: 2,
                                    copiedAt: new Date().toISOString(),
                                    pageUrl: window.location.href,
                                    items
                                };
                            }
                        
                            function parseByJsonLdAndMeta(extra = {}) {
                                const jsonLd = extractFromJsonLdProduct(findJsonLdProduct());
                                const meta = extractFromMeta();
                                return [mergeData(jsonLd, meta, extra)];
                            }
                        
                            function parseAmiAmi() {
                                const name = text('h2.item-detail__section-title') || text('h1') || getMeta('og:title');
                                const priceText = text('.item-detail__price_selling-price') || findLabelValue(['Price', 'Sale price', 'Selling price']);
                                const imageUrl = getBestImage(['img[src*="/main/"]', '.item-detail__main-img img', '.item-detail__image img', 'img']);
                        
                                let brand = '';
                                let releaseDate = '';
                                let jan = '';
                        
                                const dts = document.querySelectorAll('.item-about__data-title');
                                const dds = document.querySelectorAll('.item-about__data-text');
                        
                                dts.forEach((dt, index) => {
                                    const label = cleanText(dt.innerText || dt.textContent);
                                    const value = dds[index] ? cleanText(dds[index].innerText || dds[index].textContent) : '';
                                    if (label === 'Release Date') releaseDate = value;
                                    if (label === 'Brand') brand = value;
                                    if (/jan/i.test(label)) jan = value;
                                    jan = normalizeJan(jan) || findJanInPage();
                                });
                        
                                const codeFromUrl = window.location.href.match(/scode=([^&]+)/i);
                        
                                return [{
                                    name,
                                    price: priceText,
                                    currency: 'JPY',
                                    brand,
                                    maker: brand,
                                    manufacturer: brand,
                                    releaseDate,
                                    imageUrl,
                                    images: imageUrl ? [imageUrl] : [],
                                    sourceUrl: window.location.href,
                                    amiamiCode: codeFromUrl ? decodeURIComponent(codeFromUrl[1]) : '',
                                    jan
                                }];
                            }
                        
                            function parseHobbySearch() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct());
                                const meta = extractFromMeta();
                        
                                return [mergeData(json, meta, {
                                    store: 'HobbySearch',
                                    sourceUrl: window.location.href,
                                    url: window.location.href,
                                    code: json.code || json.mpn || extractCodeFromUrl(),
                                    currency: json.currency || meta.currency || 'USD',
                                    brand: normalizeManufacturer(json.brand || json.maker || json.manufacturer),
                                    maker: normalizeManufacturer(json.maker || json.brand || json.manufacturer)
                                })];
                            }
                        
                            function parseMandarake() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct());
                                if (json.name || json.price || json.imageUrl) {
                                    return [mergeData(json, extractFromMeta(), { store: 'Mandarake' })];
                                }
                        
                                const name = text('h1') || text('.item-title') || text('[class*="title"]') || getMeta('og:title');
                                const priceText = text('.price') || text('[class*="price"]') || findLabelValue(['Price', '販売価格']);
                                const imageUrl = getBestImage(['.itemImage img', '.product-image img', 'img[src*="manda"]', 'img']);
                                const brand = findLabelValue(['Maker', 'Manufacturer', 'Brand', 'メーカー']);
                                const releaseDate = findLabelValue(['Release Date', 'Release', '発売日']);
                        
                                return [{
                                    name,
                                    price: priceText,
                                    currency: detectCurrency(priceText) || 'JPY',
                                    brand,
                                    maker: brand,
                                    manufacturer: brand,
                                    releaseDate,
                                    imageUrl,
                                    images: imageUrl ? [imageUrl] : [],
                                    sourceUrl: window.location.href,
                                    store: 'Mandarake'
                                }];
                            }
                        
                            function parseSolaris() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct());
                                const meta = extractFromMeta();
                        
                                return [mergeData(json, meta, {
                                    store: 'Solaris Japan',
                                    sourceUrl: window.location.href,
                                    url: window.location.href
                                })];
                            }
                        
                            function parseGoodSmileEurope() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct());
                                const meta = extractFromMeta();
                        
                                let maker = json.maker || json.brand || json.manufacturer;
                                if (!maker) {
                                    const title = cleanText(json.name || meta.name || document.title);
                                    const match = title.match(/,\s*([^,|]+?)\s*\|\s*Figuya/i) || title.match(/-\s*([^-|]+?)\s*\|\s*Figuya/i);
                                    if (match) maker = cleanText(match[1]);
                                    if (/Good Smile Company/i.test(title)) maker = 'Good Smile Company';
                                }
                        
                                const releaseDate =
                          findGoodSmileEuropeReleaseDate() ||
                          findReleaseDateInPage() ||
                          json.releaseDate ||
                          meta.releaseDate ||
                          '';
                        
                        return [mergeData({
                          releaseDate
                        }, json, meta, {
                          name: json.name || stripSiteSuffix(meta.name || document.title),
                          brand: maker,
                          maker,
                          manufacturer: maker,
                          store: 'Good Smile Europe',
                          sourceUrl: window.location.href,
                          url: window.location.href
                        })];
                            }
                        
                            function parseGoodSmile() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct());
                                if (json.name || json.price || json.imageUrl) {
                                    const releaseDate =
                                          findGoodSmileReleaseDate() ||
                                          findReleaseDateInPage() ||
                                          json.releaseDate ||
                                          '';
                        
                                    return [mergeData(json, extractFromMeta(), {
                                        releaseDate,
                                        brand: json.brand || json.maker || 'Good Smile Company',
                                        maker: json.maker || json.brand || 'Good Smile Company',
                                        manufacturer: json.manufacturer || json.maker || json.brand || 'Good Smile Company',
                                        store: 'Good Smile'
                                    })];
                                }
                        
                                const name = text('h1') || text('.product-title') || getMeta('og:title');
                                const priceText = text('[class*="price"]') || findLabelValue(['Price', '価格']);
                                const imageUrl = getBestImage(['.product-image img', '.swiper-slide img', 'img']);
                                const brand = 'Good Smile Company';
                                const releaseDate =
                                      findGoodSmileReleaseDate() ||
                                      findReleaseDateInPage() ||
                                      findLabelValue(['Release Date', 'Release', '発売時期', 'Release Info']) ||
                                      '';
                                return [{
                                    name,
                                    price: priceText,
                                    currency: detectCurrency(priceText) || 'JPY',
                                    brand,
                                    maker: brand,
                                    manufacturer: brand,
                                    releaseDate,
                                    imageUrl,
                                    images: imageUrl ? [imageUrl] : [],
                                    sourceUrl: window.location.href,
                                    store: 'Good Smile'
                                }];
                            }
                        
                            function getOrzGKSelectedVariationPrice() {
                                const selectors = [
                                    '.single_variation .woocommerce-variation-price .woocommerce-Price-amount bdi',
                                    '.single_variation .woocommerce-variation-price .woocommerce-Price-amount',
                                    '.single_variation .woocommerce-variation-price .price',
                                    '.woocommerce-variation-price .woocommerce-Price-amount bdi',
                                    '.woocommerce-variation-price .woocommerce-Price-amount',
                                    '.woocommerce-variation-price .price'
                                ];
                        
                                for (const selector of selectors) {
                                    const el = document.querySelector(selector);
                                    if (!el) continue;
                        
                                    const value = cleanText(el.textContent || el.innerText || '');
                                    if (value && /[\d]/.test(value)) {
                                        return value;
                                    }
                                }
                        
                                return '';
                            }
                        
                            function getCurrencyFromPriceText(value) {
                                const raw = String(value || '');
                        
                                if (raw.includes('€')) return 'EUR';
                                if (raw.includes('$')) return 'USD';
                                if (raw.includes('¥') || raw.includes('円')) return 'JPY';
                                if (/EUR/i.test(raw)) return 'EUR';
                                if (/USD/i.test(raw)) return 'USD';
                                if (/JPY/i.test(raw)) return 'JPY';
                        
                                return '';
                            }
                        
                            function findOrzGKReleaseDate() {
                                const bodyText = cleanText(document.body ? document.body.innerText : '');
                        
                                const match = bodyText.match(
                                    /Est\.?\s*Released\s*Time[\s:：-]{0,30}(20\d{2})[\/.-](0?[1-9]|1[0-2])/i
                                );
                        
                                if (match) {
                                    return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
                                }
                        
                                return findReleaseDateInPage();
                            }
                        
                            function parseOrzGK() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct()) || {};
                                const meta = extractFromMeta() || {};
                        
                                const galleryImages = collectImagesFromSelectors([
                                    '.woocommerce-product-gallery img',
                                    '.product-gallery img',
                                    '.product img',
                                    'main img'
                                ]);
                        
                                const title = stripSiteSuffix(
                                    json.name ||
                                    meta.name ||
                                    text('h1.product-title') ||
                                    text('h1.entry-title') ||
                                    text('h1') ||
                                    document.title
                                );
                        
                                const manufacturerFromTitle =
                                      (title.match(/^([A-Z0-9][A-Z0-9 ._-]+?)\s+-\s+/i) || [])[1] || '';
                        
                                const fullText = cleanText(document.body ? document.body.innerText : '');
                        
                                const janCandidate =
                                      looksLikeJan(json.jan) ||
                                      looksLikeJan(findJanInPage()) ||
                                      looksLikeJan((fullText.match(/\b\d{12,14}\b/) || [])[0]) ||
                                      '';
                        
                                const selectedVariationPrice = getOrzGKSelectedVariationPrice();
                        
                                const priceText =
                                      selectedVariationPrice ||
                                      json.price ||
                                      meta.price ||
                                      text('.summary .price') ||
                                      text('.product .price') ||
                                      '';
                        
                                const currency =
                                      getCurrencyFromPriceText(selectedVariationPrice) ||
                                      getCurrencyFromPriceText(priceText) ||
                                      json.currency ||
                                      meta.currency ||
                                      detectCurrency(priceText) ||
                                      '';
                        
                                const images = unique([
                                    ...(json.images || []),
                                    ...(meta.images || []),
                                    ...galleryImages
                                ]);
                        
                                const releaseDate =
                                      findReleaseDateInPage() ||
                                      json.releaseDate ||
                                      meta.releaseDate ||
                                      '';
                        
                                const brand =
                                      cleanText(json.brand || json.maker || json.manufacturer || manufacturerFromTitle);
                        
                                return [{
                                    name: title,
                                    price: priceText,
                                    currency,
                        
                                    brand,
                                    maker: brand,
                                    manufacturer: brand,
                        
                                    releaseDate,
                                    month: '',
                                    year: '',
                        
                                    imageUrl: json.imageUrl || meta.imageUrl || galleryImages[0] || '',
                                    img: json.img || meta.img || galleryImages[0] || '',
                                    images,
                        
                                    jan: janCandidate,
                                    code: json.code || json.sku || json.mpn || janCandidate,
                        
                                    sku: json.sku || '',
                                    store: 'OrzGK',
                                    sourceUrl: window.location.href,
                                    url: window.location.href,
                        
                                    raw: {
                                        json,
                                        meta,
                                        selectedVariationPrice,
                                        priceText,
                                        currency
                                    }
                                }];
                            }
                        
                            function parseGeneric() {
                                const json = extractFromJsonLdProduct(findJsonLdProduct());
                                if (json.name || json.price || json.imageUrl) return [mergeData(json, extractFromMeta())];
                        
                                const name = text('h1') || text('h2') || getMeta('og:title') || document.title;
                                const priceText = text('[class*="price"]') || text('[id*="price"]') || getMeta('product:price:amount') || '';
                                const imageUrl = getBestImage(['[class*="product"] img', '[class*="gallery"] img', 'main img', 'img']);
                                const brand = findLabelValue(['Brand', 'Maker', 'Manufacturer', 'Производитель', 'Бренд']);
                                const releaseDate = findLabelValue(['Release Date', 'Release', 'Дата релиза', '発売日']);
                        
                                return [{
                                    name,
                                    price: priceText,
                                    currency: getMeta('product:price:currency') || detectCurrency(priceText),
                                    brand,
                                    maker: brand,
                                    manufacturer: brand,
                                    releaseDate,
                                    imageUrl,
                                    images: imageUrl ? [imageUrl] : [],
                                    sourceUrl: window.location.href,
                                    store: location.hostname.replace(/^www\./, '')
                                }];
                            }
                        
                            function getCurrentProfile() {
                                const host = location.hostname.replace(/^www\./, '');
                                return SITE_PROFILES.find(profile => profile.matches(host)) || {
                                    id: 'generic',
                                    name: host,
                                    matches: () => true,
                                    parse: parseGeneric
                                };
                            }
                        
                            function copyToClipboard(value) {
                                if (typeof GM_setClipboard === 'function') {
                                    GM_setClipboard(value, 'text');
                                    return Promise.resolve();
                                }
                                return navigator.clipboard.writeText(value);
                            }
                        
                            async function sendToTracker() {
                                try {
                                    const profile = getCurrentProfile();
                                    const rawItems = profile.parse();
                        
                                    const items = rawItems
                                    .map(item => normalizeItem(item, profile.id, profile.name))
                                    .filter(item => item.name || item.imageUrl || item.price);
                        
                                    if (!items.length) {
                                        alert('Не получилось найти данные товара на этой странице.');
                                        return;
                                    }
                        
                                    const payload = makePayload(profile, items);
                                    const dataStr = JSON.stringify(payload, null, 2);
                        
                                    await copyToClipboard(dataStr);
                        
                                    const first = items[0];
                                    alert(
                                        `Скопировано для Figure Tracker!\n\n` +
                                        `Сайт: ${profile.name}\n` +
                                        `Название: ${first.name || '—'}\n` +
                                        `Цена: ${first.price || '—'} ${first.currency || ''}\n` +
                                        `Производитель: ${first.maker || '—'}\n` +
                                        `${first.jan ? `JAN: ${first.jan}\n` : ''}` +
                                        `${first.code ? `Код: ${first.code}` : ''}`
                              );
                                } catch (error) {
                                    console.error('[Figure Tracker Importer]', error);
                                    alert('Ошибка при сборе данных. Подробности в console.');
                                }
                            }
                        
                            function createButton() {
                                if (document.getElementById('figure-tracker-import-btn')) return;
                        
                                const btn = document.createElement('button');
                                btn.id = 'figure-tracker-import-btn';
                                btn.innerHTML = '📋 В трекер';
                        
                                Object.assign(btn.style, {
                                    position: 'fixed',
                                    top: '115px',
                                    right: '20px',
                                    zIndex: '999999',
                                    padding: '10px 16px',
                                    background: '#f38029',
                                    color: '#ffffff',
                                    fontSize: '14px',
                                    fontWeight: 'bold',
                                    border: 'none',
                                    borderRadius: '10px',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                                    transition: 'transform 0.15s ease, background 0.2s ease'
                                });
                        
                                btn.addEventListener('mouseenter', () => {
                                    btn.style.background = '#ff9a3d';
                                    btn.style.transform = 'translateY(-1px)';
                                });
                        
                                btn.addEventListener('mouseleave', () => {
                                    btn.style.background = '#f38029';
                                    btn.style.transform = 'translateY(0)';
                                });
                        
                                btn.addEventListener('click', sendToTracker);
                        
                                document.body.appendChild(btn);
                            }
                        
                            function waitForPageReady() {
                                if (document.readyState === 'loading') {
                                    document.addEventListener('DOMContentLoaded', createButton);
                                } else {
                                    createButton();
                                }
                            }
                        
                            waitForPageReady();
                        })();
3. Переходите на AmiAmi, заходите на страницу с фигуркой и там будет кнопка '📋 В трекер'
4. Переходите на мой проект и нажимаете '+ Добавить заказ' или тому подобное
5. Потом
   <img width="747" height="861" alt="изображение" src="https://github.com/user-attachments/assets/952f5ec3-3b09-4597-8880-4546f868397e" />


### добавил еще сохранение фотграфий на телеграм там нужно просто создать канал и бота, через @BotFather (просто дайте имя и ID @ваш_бот и все) и вставить токен, и ссылку на канал в который вы добавили своего бота

---

### 🇬🇧 How to use

1. Go to [https://script.google.com](https://script.google.com)
2. Create a new project.
3. Paste the code below and save it.
4. Click **Deploy**.
5. Select **Web App**.
6. Configure access:

   * Execute as: **Me**
   * Who has access: **Anyone**
7. Click **Deploy**.
8. Grant the required permissions.
9. Google will generate a **Web App URL**. Use this URL in the project settings.

**Note:** I may add more languages in the future (probably using a translator 😅).

    function doPost(e) {
      try {
        if (!e || !e.postData || !e.postData.contents) throw new Error("Нет данных");
        const payload = JSON.parse(e.postData.contents);
    
        // === ЗАГРУЗКА КАРТИНКИ || Loading image ===
        // Если приложение прислало специальную команду 'uploadImage'
        if (payload.action === 'uploadImage') {
          const FOLDER_NAME = 'FigureTracker_Photos';
          let folders = DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME);
          let folder = folders.hasNext() ? folders.next() : DriveApp.getRootFolder().createFolder(FOLDER_NAME);
    
          // Конвертируем текстовый код (Base64) обратно в картинку
          const blob = Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType, payload.filename);
          const file = folder.createFile(blob);
          
          // Даем картинке доступ "По ссылке", чтобы она могла загрузиться в галерее
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
          // Генерируем специальную ссылку для тега <img>
    const directUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
          return ContentService.createTextOutput(JSON.stringify({ ok: true, url: directUrl }))
            .setMimeType(ContentService.MimeType.JSON);
        }
    
        // === СОХРАНЕНИЕ БЭКАПА || Save backup ===
        const FILE_NAME = 'figure-tracker-backup.json';
        const PREV_FILE_NAME = 'figure-tracker-backup-prev.json';
        
        const content = JSON.stringify(payload, null, 2);
        const folder = DriveApp.getRootFolder();
        
        const prevFiles = folder.getFilesByName(PREV_FILE_NAME);
        while (prevFiles.hasNext()) prevFiles.next().setTrashed(true);
        
        const currentFiles = folder.getFilesByName(FILE_NAME);
        if (currentFiles.hasNext()) currentFiles.next().setName(PREV_FILE_NAME);
        
        folder.createFile(FILE_NAME, content, MimeType.PLAIN_TEXT);
    
        return ContentService.createTextOutput(JSON.stringify({ ok: true, filename: FILE_NAME }))
          .setMimeType(ContentService.MimeType.JSON);
    
      } catch(err) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
      
      function doGet(e) {
        try {
          const version = (e.parameter && e.parameter.version === 'prev') ? PREV_FILE_NAME : FILE_NAME;
          const files = DriveApp.getRootFolder().getFilesByName(version);
      
          if (!files.hasNext()) {
            return ContentService
              .createTextOutput(JSON.stringify({ ok: false, error: `Бэкап не найден (${version})` }))
              .setMimeType(ContentService.MimeType.JSON);
          }
      
          const content = files.next().getBlob().getDataAsString();
          
          return ContentService
            .createTextOutput(JSON.stringify({ ok: true, version: version, state: JSON.parse(content) }))
            .setMimeType(ContentService.MimeType.JSON);
      
        } catch(err) {
          return ContentService
            .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
