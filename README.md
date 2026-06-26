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
          // @name         AmiAmi to Tracker
          // @namespace    http://tampermonkey.net/
          // @version      1.0
          // @description  Добавляет кнопку отправки данных в трекер
          // @author       You
          // @match        https://www.amiami.com/eng/detail/*
          // @grant        none
          // ==/UserScript==
          
          (function() {
              'use strict';
          
          function sendToTracker() {
              // 1. Собираем данные
              const nameEl = document.querySelector('h2.item-detail__section-title');
              const name = nameEl ? nameEl.innerText.trim() : "Не найдено";
          
              const priceEl = document.querySelector('.item-detail__price_selling-price');
              const price = priceEl ? priceEl.innerText.replace(/[^0-9]/g, '') : "0";
          
              // Ищем картинку, которая содержит 'main' в пути — это всегда самое качественное изображение товара
          const imgEl = document.querySelector('img[src*="/main/"]');
          const img = imgEl ? imgEl.src : "";
          
              // Поиск Бренда и Даты
              let brand = "";
              let releaseDate = "";
              const dts = document.querySelectorAll('.item-about__data-title');
              const dds = document.querySelectorAll('.item-about__data-text');
          
              dts.forEach((dt, index) => {
                  const text = dt.innerText.trim();
                  if (text === "Release Date") releaseDate = dds[index].innerText.trim();
                  if (text === "Brand") brand = dds[index].innerText.trim();
              });
          
              // 2. Логика обработки даты (то самое, что тебя смутило)
              // Разделяем "Sep-2017" на части
              let monthPart = releaseDate.split('-')[0]; // "Sep"
              let yearPart = releaseDate.split('-')[1];  // "2017"
          
              // Карта перевода на русский
              const monthsMap = {
                  "Jan":"Январь", "Feb":"Февраль", "Mar":"Март", "Apr":"Апрель", "May":"Май", "Jun":"Июнь",
                  "Jul":"Июль", "Aug":"Август", "Sep":"Сентябрь", "Oct":"Октябрь", "Nov":"Ноябрь", "Dec":"Декабрь"
              };
          
              // Формируем объект данных
              const data = {
                  name,
                  price,
                  brand,
                  month: monthsMap[monthPart] || monthPart,
                  year: yearPart,
                  img,
                  url: window.location.href // ДОБАВЛЯЕМ ЭТУ СТРОКУ
              };
          
              // 3. Копируем в буфер
              const dataStr = JSON.stringify(data);
              navigator.clipboard.writeText(dataStr).then(() => {
                  alert('Данные скопированы, включая ссылку на товар!');
              });
          }
          
              // Создаем кнопку на странице
              const btn = document.createElement('button');
              btn.innerHTML = '📋 В трекер';
              btn.style.position = 'fixed';
              btn.style.top = '115px';
              btn.style.right = '20px';
              btn.style.zIndex = '9999';
              btn.style.padding = '10px 16px';
              btn.style.background = '#f38029';
              btn.style.color = '#ffffff';
              btn.style.fontSize = '14px';
              btn.style.fontWeight = 'bold';
              btn.style.border = 'none'
              btn.style.borderRadius = '0px';
              btn.style.cursor = 'pointer';
              btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
              btn.style.transition = 'background 0.3s';
          
              btn.onclick = sendToTracker;
              document.body.appendChild(btn);
          })();
3. Переходите на AmiAmi, заходите на страницу с фигуркой и там будет кнопка '📋 В трекер'
4. Переходите на мой проект и нажимаете '+ Добавить заказ' или тому подобное
5. Потом
   <img width="747" height="861" alt="изображение" src="https://github.com/user-attachments/assets/952f5ec3-3b09-4597-8880-4546f868397e" />


### Вспомнил я добавил еще сохранение фотграфий на телеграм там нужно просто создать канал и бота, через @BotFather (просто дайте имя и ID @ваш_бот и все) и вставить токен, и ссылку на канал в который вы добавили своего бота

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
