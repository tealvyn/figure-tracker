// js/media-storage.js
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MEDIA_SIZE_WARNING_BYTES = 10 * 1024 * 1024;
const STATIC_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ANIMATION_TYPES = new Set(['image/gif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_UPLOAD_TYPES = new Set([
  ...STATIC_IMAGE_TYPES,
  ...ANIMATION_TYPES,
  ...VIDEO_TYPES
]);

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function safeTelegramError(message) {
  return clean(message).replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[hidden]');
}

function notifyProgress(options, message) {
  if (typeof options?.onProgress === 'function') options.onProgress(message);
}

function getFileMetadata(file, mediaType = '') {
  return {
    mediaType: clean(mediaType),
    name: clean(file?.name),
    mimeType: clean(file?.type),
    size: Number(file?.size || 0),
    originalName: clean(file?.name)
  };
}

function limitText(value, max = 180) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function buildTelegramCaption(file, mediaType, extra = {}) {
  const metadata = {
    app: 'FigureTracker',
    mediaType: clean(mediaType),
    name: limitText(file?.name),
    mimeType: clean(file?.type),
    size: Number(file?.size || 0),
    uploadedAt: nowIso(),
    extra: extra && typeof extra === 'object' ? extra : {}
  };
  let caption = JSON.stringify(metadata);
  if (caption.length <= 950) return caption;

  metadata.extra = { truncated: true };
  metadata.name = limitText(file?.name, 100);
  caption = JSON.stringify(metadata);
  if (caption.length <= 950) return caption;

  metadata.name = limitText(file?.name, 40);
  return JSON.stringify(metadata);
}

export function getUploadMediaType(file) {
  const type = clean(file?.type).toLowerCase();
  if (STATIC_IMAGE_TYPES.has(type)) return 'photo';
  if (ANIMATION_TYPES.has(type)) return 'animation';
  if (VIDEO_TYPES.has(type)) return 'video';
  return '';
}

function assertUploadFile(file) {
  if (!file) throw new Error('Файл не выбран');
  const type = clean(file.type).toLowerCase();
  if (!ALLOWED_UPLOAD_TYPES.has(type)) {
    throw new Error('Можно загружать JPG, PNG, WebP, GIF или видео MP4/WebM/MOV.');
  }
  if (file.size > MEDIA_SIZE_WARNING_BYTES) {
    console.warn('[media-storage] Large media selected:', file.name, file.size);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function getLargestTelegramPhoto(sendData) {
  const photos = sendData?.result?.photo;
  if (!Array.isArray(photos) || !photos.length) return null;
  return photos[photos.length - 1];
}

function getTelegramUploadConfig(mediaType) {
  if (mediaType === 'animation') {
    return {
      endpoint: 'sendAnimation',
      field: 'animation',
      resultField: 'animation',
      progress: 'Отправка GIF в Telegram...'
    };
  }
  if (mediaType === 'video') {
    return {
      endpoint: 'sendVideo',
      field: 'video',
      resultField: 'video',
      progress: 'Отправка видео в Telegram...'
    };
  }
  return {
    endpoint: 'sendPhoto',
    field: 'photo',
    resultField: 'photo',
    progress: 'Отправка фото в Telegram...'
  };
}

function getTelegramFileId(sendData, mediaType) {
  if (mediaType === 'photo') return clean(getLargestTelegramPhoto(sendData)?.file_id);
  const field = getTelegramUploadConfig(mediaType).resultField;
  return clean(sendData?.result?.[field]?.file_id);
}

export function isBase64Image(value) {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim());
}

export function createExternalImage(url) {
  return {
    provider: 'external',
    url: clean(url),
    fileId: '',
    thumbUrl: '',
    mediaType: '',
    createdAt: nowIso(),
    name: '',
    mimeType: '',
    size: 0,
    originalName: '',
    caption: ''
  };
}

export function createTelegramImage(data = {}) {
  return {
    provider: 'telegram',
    url: clean(data.url),
    fileId: clean(data.fileId),
    thumbUrl: clean(data.thumbUrl),
    mediaType: clean(data.mediaType),
    createdAt: data.createdAt || nowIso(),
    name: clean(data.name),
    mimeType: clean(data.mimeType),
    size: Number(data.size || 0),
    originalName: clean(data.originalName || data.name),
    caption: clean(data.caption)
  };
}

export function createDriveImage(data = {}) {
  return {
    provider: 'drive',
    url: clean(data.url),
    fileId: clean(data.fileId),
    thumbUrl: clean(data.thumbUrl),
    mediaType: clean(data.mediaType),
    createdAt: data.createdAt || nowIso(),
    name: clean(data.name),
    mimeType: clean(data.mimeType),
    size: Number(data.size || 0),
    originalName: clean(data.originalName || data.name),
    caption: clean(data.caption)
  };
}

export function normalizeImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return createExternalImage(image);
  if (typeof image !== 'object') return null;

  const provider = clean(image.provider) || 'external';
  return {
    provider,
    url: clean(image.url),
    fileId: clean(image.fileId),
    thumbUrl: clean(image.thumbUrl),
    mediaType: clean(image.mediaType),
    createdAt: image.createdAt || nowIso(),
    name: clean(image.name),
    mimeType: clean(image.mimeType),
    size: Number(image.size || 0),
    originalName: clean(image.originalName || image.name),
    caption: clean(image.caption)
  };
}

export function getImageUrl(image) {
  return getMediaUrl(image);
}

export async function uploadImageToTelegram(file, settings = {}, options = {}) {
  assertUploadFile(file);
  const mediaType = getUploadMediaType(file);
  const uploadConfig = getTelegramUploadConfig(mediaType);

  const tgBotToken = clean(settings.tgBotToken);
  const tgChatId = clean(settings.tgChatId);
  if (!tgBotToken || !tgChatId) {
    throw new Error('Telegram не настроен: укажите bot token и chat id');
  }

  notifyProgress(options, uploadConfig.progress);
  const caption = buildTelegramCaption(file, mediaType, options?.captionExtra || {});
  const formData = new FormData();
  formData.append('chat_id', tgChatId);
  formData.append(uploadConfig.field, file);
  formData.append('caption', caption);

  const sendRes = await fetch(`${TELEGRAM_API_BASE}/bot${tgBotToken}/${uploadConfig.endpoint}`, {
    method: 'POST',
    body: formData
  });
  const sendData = await sendRes.json().catch(() => ({}));
  if (!sendData.ok) {
    throw new Error(safeTelegramError(sendData.description || 'Не удалось отправить файл в Telegram'));
  }

  const fileId = getTelegramFileId(sendData, mediaType);
  if (!fileId) throw new Error('Telegram не вернул file_id');

  notifyProgress(options, 'Получение ссылки Telegram...');
  const pathRes = await fetch(`${TELEGRAM_API_BASE}/bot${tgBotToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const pathData = await pathRes.json().catch(() => ({}));
  if (!pathData.ok) {
    throw new Error(safeTelegramError(pathData.description || 'Не удалось получить путь к файлу Telegram'));
  }

  const filePath = clean(pathData?.result?.file_path);
  if (!filePath) throw new Error('Telegram не вернул путь к файлу');

  // TODO: For public deployment, Telegram token must not be exposed in client-side URLs.
  const url = `${TELEGRAM_API_BASE}/file/bot${tgBotToken}/${filePath}`;
  return createTelegramImage({
    url,
    fileId,
    ...getFileMetadata(file, mediaType),
    caption
  });
}

export async function uploadImageToDrive(file, settings = {}, options = {}) {
  assertUploadFile(file);
  const mediaType = getUploadMediaType(file);

  const scriptUrl = clean(settings.scriptUrl);
  if (!scriptUrl) throw new Error('Google Script не настроен: укажите ссылку в настройках');

  notifyProgress(options, mediaType === 'video' ? 'Добавление видео на Google Диск...' : 'Добавление файла на Google Диск...');
  const dataUrl = await readFileAsDataUrl(file);
  const base64Content = dataUrl.split(',')[1] || '';
  const payload = {
    action: 'uploadImage',
    filename: file.name,
    mimeType: file.type,
    base64: base64Content
  };

  const response = await fetch(scriptUrl, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  const url = clean(result.url || result.webContentLink || result.webViewLink);

  if (result.ok === false || !url) {
    throw new Error(result.error || 'Не удалось получить ссылку Google Диска');
  }

  return createDriveImage({
    url,
    fileId: result.fileId || result.id || '',
    ...getFileMetadata(file, mediaType)
  });
}

export async function uploadImage(file, settings = {}, options = {}) {
  assertUploadFile(file);

  const hasTelegram = Boolean(clean(settings.tgBotToken) && clean(settings.tgChatId));
  const hasDrive = Boolean(clean(settings.scriptUrl));
  let telegramError = null;

  if (hasTelegram) {
    try {
      return await uploadImageToTelegram(file, settings, options);
    } catch (error) {
      telegramError = error;
      if (!hasDrive) throw error;
      console.warn('[media-storage] Telegram upload failed, trying Drive fallback:', safeTelegramError(error?.message));
    }
  }

  if (hasDrive) {
    try {
      return await uploadImageToDrive(file, settings, options);
    } catch (driveError) {
      if (telegramError) {
        throw new Error(`Telegram и Google Drive не смогли загрузить файл: ${safeTelegramError(driveError.message)}`);
      }
      throw driveError;
    }
  }

  throw new Error('Сначала укажите настройки Telegram или ссылку на Google Script в Настройках');
}

export async function uploadMediaBatch(filesInput, settings = {}, options = {}) {
  const files = Array.from(filesInput || []).filter(Boolean);
  if (!files.length) return [];

  const uploaded = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const prefix = `${index + 1}/${files.length}`;
    const media = await uploadImage(file, settings, {
      ...options,
      onProgress(message) {
        notifyProgress(options, `${prefix}: ${message}`);
      }
    });
    uploaded.push(media);
    if (typeof options?.onFileUploaded === 'function') {
      options.onFileUploaded(media, index, files.length);
    }
  }

  return uploaded;
}

export function isVideoUrl(url = '') {
  return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(String(url));
}

export function isGifUrl(url = '') {
  return /\.gif(\?|#|$)/i.test(String(url));
}

export function getMediaUrl(media) {
  if (!media) return '';
  if (typeof media === 'string') return media;
  if (typeof media !== 'object') return '';
  return clean(media.thumbUrl) || clean(media.url) || clean(media.imageUrl) || clean(media.videoUrl);
}

export function getMediaKind(media) {
  if (!media) return 'image';

  if (typeof media === 'object') {
    const mediaType = clean(media.mediaType).toLowerCase();
    const mimeType = clean(media.mimeType).toLowerCase();
    const name = clean(media.name).toLowerCase();
    const url = clean(media.url).toLowerCase();
    const type = clean(media.type).toLowerCase();

    if (mediaType === 'animation' || type === 'animation') return 'animation';
    if (url.includes('/animations/')) return 'animation';
    if (mimeType === 'image/gif' || name.endsWith('.gif')) return 'animation';

    if (mediaType === 'photo' || mediaType === 'image' || type === 'image') return 'image';
    if (mediaType === 'video' || type === 'video') return 'video';

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';

    return detectMediaKind(url || name, mimeType);
  }

  return detectMediaKind(String(media));
}

export function renderMediaTag(media, className = '', alt = '') {
  const url = getMediaUrl(media);
  if (!url) return '';

  const kind = getMediaKind(media);
  const safeUrl = String(url).replace(/"/g, '&quot;');
  const safeAlt = String(alt || '').replace(/"/g, '&quot;');

  if (kind === 'animation') {
    return `
      <video class="${className}" autoplay loop muted playsinline preload="metadata" onclick="event.stopPropagation()">
        <source src="${safeUrl}">
      </video>
    `;
  }

  if (kind === 'video') {
    return `
      <video class="${className}" controls preload="metadata" playsinline onclick="event.stopPropagation()">
        <source src="${safeUrl}">
      </video>
    `;
  }

  return `<img class="${className}" src="${safeUrl}" alt="${safeAlt}" loading="lazy" onerror="this.style.opacity='.1'">`;
}

export function detectMediaKind(fileOrUrl, mimeType = '') {
  const name = (typeof fileOrUrl === 'string'
    ? fileOrUrl
    : fileOrUrl?.name || '').toLowerCase();

  const mime = (mimeType || fileOrUrl?.type || '').toLowerCase();

  if (name.includes('/animations/')) {
    return 'animation';
  }

  if (mime === 'image/gif' || /\.gif(\?|#|$)/i.test(name)) {
    return 'animation';
  }

  if (mime.startsWith('image/')) {
    return 'image';
  }

  if (mime.startsWith('video/')) {
    return 'video';
  }

  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(name)) {
    return 'video';
  }

  return 'image';
}
