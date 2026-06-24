    const FILE_NAME = 'figure-tracker-backup.json';
    const PREV_FILE_NAME = 'figure-tracker-backup-prev.json';
    
    function doPost(e) {
      try {
        if (!e || !e.postData || !e.postData.contents) throw new Error("Нет данных");
        const payload = JSON.parse(e.postData.contents);
    
        // === РЕЖИМ 1: ЗАГРУЗКА КАРТИНКИ ===
        // Если приложение прислало специальную команду 'uploadImage'
        if (payload.action === 'uploadImage') {
          const FOLDER_NAME = 'FigureTracker_Photos';
          let folders = DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME);
          let folder = folders.hasNext() ? folders.next() : DriveApp.getRootFolder().createFolder(FOLDER_NAME);
    
          // Конвертируем текстовый код (Base64) обратно в картинку
          const blob = Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType, payload.filename);
          const file = folder.createFile(blob);
          
          // Даем картинке доступ "По ссылке", чтобы она могла загрузиться в твоей галерее
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
          // Генерируем специальную ссылку для тега <img>
    // ИСПРАВЛЕНИЕ: Используем секретный сервер Googleusercontent, который пропускает картинки на сайты
    const directUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
          return ContentService.createTextOutput(JSON.stringify({ ok: true, url: directUrl }))
            .setMimeType(ContentService.MimeType.JSON);
        }
    
        // === РЕЖИМ 2: СОХРАНЕНИЕ БЭКАПА (твоя обычная база данных) ===
        // Если action нет, скрипт понимает, что это прилетела коллекция JSON
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
    
      // Твой doGet оставляй без изменений (из предыдущего ответа)
      
      function doGet(e) {
        try {
          // Позволяем запросить предыдущий бэкап через параметр, например: ?version=prev
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


### 🇷🇺 Как пользоваться

1. Перейдите на [https://script.google.com](https://script.google.com)
2. Создайте новый проект.
3. Вставьте код и сохраните его.
4. Нажмите **«Начать развертывание» (Deploy)**.
5. Выберите **«Веб-приложение» (Web App)**.
6. Настройте права доступа:

   * Выполнять от имени: **Меня**
   * Доступ: **Все**
7. Нажмите **«Развернуть»**.
8. Выдайте необходимые разрешения.
9. После развертывания Google выдаст **URL веб-приложения** — откройте его или используйте в своем проекте.

---

### 🇬🇧 How to use

1. Go to [https://script.google.com](https://script.google.com)
2. Create a new project.
3. Paste your code and save it.
4. Click **Deploy**.
5. Select **Web App**.
6. Configure access:

   * Execute as: **Me**
   * Who has access: **Anyone**
7. Click **Deploy**.
8. Grant the required permissions.
9. Google will generate a **Web App URL**. Open this link or use it in your application.

**Note:** Whenever you update the code, create a new deployment version or update the existing deployment to apply the changes.
