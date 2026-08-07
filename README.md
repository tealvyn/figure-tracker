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
2. Заходите в Настройки и нажимаете "Установить скрипт"
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

                  // === ГЛОБАЛЬНЫЕ НАСТРОЙКИ (видны всем функциям) ===
                  const FILE_NAME = 'figure-tracker-backup.json';
                  const PREV_FILE_NAME = 'figure-tracker-backup-prev.json';
                  
                  // === ОБРАБОТКА POST ЗАПРОСОВ (Сохранение бэкапа и загрузка фото) ===
                  function doPost(e) {
                    try {
                      if (!e || !e.postData || !e.postData.contents) throw new Error("Нет данных");
                      const payload = JSON.parse(e.postData.contents);
                  
                      // Режим 1: Загрузка картинки
                      if (payload.action === 'uploadImage') {
                        const FOLDER_NAME = 'FigureTracker_Photos';
                        let folders = DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME);
                        let folder = folders.hasNext() ? folders.next() : DriveApp.getRootFolder().createFolder(FOLDER_NAME);
                  
                        const blob = Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType, payload.filename);
                        const file = folder.createFile(blob);
                        
                        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                  
                        const directUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();
                        return ContentService.createTextOutput(JSON.stringify({ ok: true, url: directUrl }))
                          .setMimeType(ContentService.MimeType.JSON);
                      }
                  
                      // Режим 2: Сохранение бэкапа базы данных
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
                  
                  // === ОБРАБОТКА GET ЗАПРОСОВ (Автозаполнение AmiAmi и Загрузка бэкапа) ===
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
                  
