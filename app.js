let tracks = [];
let currentTrackIndex = -1;
let playlists = JSON.parse(localStorage.getItem('playlists')) || {};
let db;

const audio = document.getElementById('audio-player');
const btnPlay = document.getElementById('btn-play');
const trackList = document.getElementById('track-list');

// Инициализация при старте приложения
initDB().then(() => {
    loadSavedDirectory(); // Пытаемся автоматически загрузить прошлую папку
    renderPlaylists();
});

// 1. БАЗА ДАННЫХ ДЛЯ СОХРАНЕНИЯ ДОСТУПА К ПАПКЕ
function initDB() {
    return new Promise((resolve) => {
        let request = indexedDB.open("musiCallDB", 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            db.createObjectStore("settings");
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };
    });
}

// Пытаемся прочитать старую папку без повторного выбора
async function loadSavedDirectory() {
    if (!db) return;
    let tx = db.transaction("settings", "readonly");
    let store = tx.objectStore("settings");
    let request = store.get("dirHandle");

    request.onsuccess = async () => {
        const dirHandle = request.result;
        if (dirHandle) {
            try {
                // Запрашиваем у Android подтверждение прав (появится быстрое всплывающее окно)
                if (await dirHandle.queryPermission({ mode: 'read' }) === 'granted' || 
                    await dirHandle.requestPermission({ mode: 'read' }) === 'granted') {
                    
                    document.getElementById('dir-path-display').value = dirHandle.name;
                    await readDirectory(dirHandle);
                }
            } catch (err) {
                console.log("Старая папка больше недоступна, выберите заново");
            }
        }
    };
}

// Функция чтения всех файлов в папке
async function readDirectory(dirHandle) {
    tracks = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
            const file = await entry.getFile();
            tracks.push({
                name: file.name.replace(/\.[^/.]+$/, ""), // Убираем .mp3 из названия
                url: URL.createObjectURL(file) // Создаем ссылку для воспроизведения
            });
        }
    }
    if (tracks.length > 0) {
        renderTracks();
    }
}

// Кнопка выбор папки
document.getElementById('btn-select-dir').addEventListener('click', async () => {
    try {
        const dirHandle = await window.showDirectoryPicker();
        
        // Сохраняем "ключ" от папки в базу данных на будущее
        let tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put(dirHandle, "dirHandle");

        document.getElementById('dir-path-display').value = dirHandle.name;
        await readDirectory(dirHandle);
        alert(`Найдено и сохранено треков: ${tracks.length}`);
    } catch (err) {
        alert('Доступ к папке не получен. Откройте приложение через Google Chrome.');
    }
});

// 2. ОТРИСОВКА СПИСКА И ПЛЕЕР
function renderTracks() {
    trackList.innerHTML = '';
    tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = `track-item ${index === currentTrackIndex ? 'current' : ''}`;
        li.innerHTML = `
            <span onclick="playTrack(${index})">${track.name}</span>
            <div class="track-actions">
                <button onclick="addTrackToPlaylist(${index})"><i class="fas fa-plus"></i></button>
                <button onclick="deleteTrack(${index})"><i class="fas fa-trash"></i></button>
            </div>
        `;
        trackList.appendChild(li);
    });
}

function playTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    currentTrackIndex = index;
    audio.src = tracks[index].url;
    document.getElementById('track-title').textContent = tracks[index].name;

    // Интеграция со шторкой Android
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: tracks[index].name,
            artist: 'musiCall Pro',
            album: 'Локальная папка',
            artwork: [{ src: 'img.jpg', sizes: '512x512', type: 'image/jpeg' }]
        });
        navigator.mediaSession.setActionHandler('play', () => audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => playTrack(currentTrackIndex - 1));
        navigator.mediaSession.setActionHandler('nexttrack', () => playTrack(currentTrackIndex + 1));
    }

    audio.play();
    renderTracks();
}

// Точный звук (100 делений)
document.getElementById('volume-control').addEventListener('input', (e) => {
    let vol = e.target.value;
    audio.volume = vol / 100;
    document.getElementById('volume-value').textContent = `${vol}%`;
});

// 3. РАБОЧИЕ ПЛЕЙЛИСТЫ (Сохраняют только имена треков)
function createNewPlaylist() {
    const name = document.getElementById('new-playlist-name').value.trim();
    if (!name) return;
    if (!playlists[name]) playlists[name] = [];
    localStorage.setItem('playlists', JSON.stringify(playlists));
    document.getElementById('new-playlist-name').value = '';
    renderPlaylists();
}

function renderPlaylists() {
    const container = document.getElementById('playlist-list');
    container.innerHTML = '';
    Object.keys(playlists).forEach(name => {
        const li = document.createElement('li');
        li.className = 'track-item';
        li.innerHTML = `
            <span onclick="playPlaylist('${name}')"><i class="fas fa-compact-disc"></i> ${name} (${playlists[name].length} шт.)</span>
            <button onclick="deletePlaylist('${name}')" style="background:none; border:none; color:#ff4444;"><i class="fas fa-trash"></i></button>
        `;
        container.appendChild(li);
    });
}

function addTrackToPlaylist(index) {
    const pNames = Object.keys(playlists);
    if (pNames.length === 0) return alert("Создайте плейлист в Настройках!");
    
    let target = prompt(`В какой плейлист добавить?\nДоступные: ${pNames.join(', ')}`);
    if (target && playlists[target]) {
        let trackName = tracks[index].name;
        if (!playlists[target].includes(trackName)) {
            playlists[target].push(trackName);
            localStorage.setItem('playlists', JSON.stringify(playlists));
            renderPlaylists();
        }
    }
}

// Включение плейлиста
function playPlaylist(name) {
    let playlistTrackNames = playlists[name];
    // Фильтруем основной список треков, оставляя только те, что есть в плейлисте
    let playlistTracks = tracks.filter(t => playlistTrackNames.includes(t.name));
    
    if(playlistTracks.length === 0) {
        alert("В этом плейлисте нет треков, которые сейчас есть в выбранной папке.");
        return;
    }
    
    // Перезаписываем текущий список треков списком из плейлиста и запускаем первый
    tracks = playlistTracks;
    renderTracks();
    changeScreen('player'); // Переключаем экран на плеер
    playTrack(0);
}

function deletePlaylist(name) {
    delete playlists[name];
    localStorage.setItem('playlists', JSON.stringify(playlists));
    renderPlaylists();
}

function deleteTrack(index) {
    if (confirm(`Убрать ${tracks[index].name} из текущего списка?`)) {
        tracks.splice(index, 1);
        renderTracks();
    }
}

// Переход на следующий трек по окончании
audio.addEventListener('ended', () => {
    playTrack(currentTrackIndex + 1);
});

// Функция переключения экранов (вкладки Плеер, Настройки, Профиль)
function changeScreen(screenId) {
    // 1. Прячем все экраны приложения
    document.querySelectorAll('.app-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // 2. Убираем подсветку со всех кнопок в меню
    document.querySelectorAll('.nav-item').forEach(button => {
        button.classList.remove('active');
    });
    
    // 3. Показываем нужный экран
    const targetScreen = document.getElementById(`screen-${screenId}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
    
    // 4. Подсвечиваем кнопку, на которую нажали
    // Ищем кнопку по переданному screenId внутри её события
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
}
