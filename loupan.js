// 全局变量
let map;
let loupanMarkers = []; // 项为 { marker, loupan }
let loupanData = {
    loupanList: [],
    subwayList: [],
    commerceList: [],
    parkList: [],
    hospitalList: [],
    municipalList: []
};
let currentZoom = 16;
let currentLoupanPolygon = null;
let currentLoupanKey = null;
let currentPoiMarkers = []; // 当前显示的周边配套点位，关闭时移除
let schoolsData = { primarySchools: [], middleSchools: [] };
let currentSchoolMarkers = []; // 当前显示的学区学校点位，关闭时移除
let currentLoupan = null; // 当前进入的楼盘对象，用于筛选时重新取数
// 配套筛选状态：勾选则展示该类型。默认：小学、中学、地铁、商业、公园
let filterState = {
    primary: true, middle: true, subway: true, commerce: true, park: true,
    hospital: false, municipal: false
};
// 搜索：默认搜学校，可切换搜楼盘
let searchMode = 'school'; // 'school' | 'loupan'
let currentSchoolDistrictPolygon = null; // 当前选中的学区多边形，退出楼盘后保留
let currentSchoolDistrictPath = null;     // 学区路径数组，用于判断楼盘是否在内
let currentSchoolDistrictSchool = null;  // 当前学区对应的学校（含 type: primary|middle）

// 初始化地图（与 school.html 相同的高德地图配置）
function initMap(center) {
    map = new AMap.Map('map', {
        zooms: [14, 22],
        zoom: 16,
        center: center,
        viewMode: '3D',
        terrain: true,
        pitch: 0,
        rotation: 0,
        scrollWheel: true,
        zoomEnable: true,
        doubleClickZoom: true,
        dragEnable: true,
        pitchEnable: false,
        rotateEnable: false,
        showBuildingBlock: false,
        showLabel: true
    });

    const controlBar = new AMap.ControlBar({
        position: {
            top: '100px',
            right: '20px'
        },
        showZoomBar: true,
        showControlButton: true
    });
    map.addControl(controlBar);

    const scale = new AMap.Scale({
        position: 'LB'
    });
    map.addControl(scale);

    const toolBar = new AMap.ToolBar({
        position: {
            bottom: '80px',
            right: '20px'
        },
        ruler: true,
        direction: true,
        autoPosition: false,
        locate: true
    });
    map.addControl(toolBar);

    map.on('zoomend', function() {
        currentZoom = map.getZoom();
    });
}

// 加载楼盘及配套数据
async function loadLoupanData() {
    try {
        const res = await fetch('loupan.json');
        if (res.ok) {
            const data = await res.json();
            loupanData.loupanList = data.loupanList || [];
            loupanData.subwayList = data.subwayList || [];
            loupanData.commerceList = data.commerceList || [];
            loupanData.parkList = data.parkList || [];
            loupanData.hospitalList = data.hospitalList || [];
            loupanData.municipalList = data.municipalList || [];
            initLoupanMarkers();
        }
    } catch (e) {
        console.error('加载 loupan.json 失败', e);
    }
}

// 加载学校数据（学区范围用于判断楼盘对应学校）
async function loadSchoolData() {
    try {
        const res = await fetch('school.json');
        if (res.ok) {
            const data = await res.json();
            schoolsData.primarySchools = data.primarySchools || [];
            schoolsData.middleSchools = data.middleSchools || [];
        }
    } catch (e) {
        console.error('加载 school.json 失败', e);
    }
}

// 获取学校学区路径（与 school.js 一致）
function getSchoolDistrictPath(school) {
    var d = school.district;
    if (!d || !d.polygon || !Array.isArray(d.polygon) || d.polygon.length === 0) return null;
    var ring = d.polygon[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring;
}

// ---------- 搜索：模糊匹配（子串、单字、拼音首字母） ----------
function fuzzyMatchName(name, query) {
    if (!query || !name) return false;
    var q = query.trim().toLowerCase();
    var n = name.trim();
    if (!q) return true;
    // 1) 子串包含
    if (n.indexOf(q) !== -1) return true;
    // 2) 单字模糊：查询串每个字都在名称中出现
    var qChars = Array.from(q);
    if (qChars.every(function(c) { return n.indexOf(c) !== -1; })) return true;
    // 3) 拼音首字母（若存在 pinyin-pro）
    if (typeof pinyinPro !== 'undefined' && pinyinPro.pinyin) {
        try {
            var pyFirst = (pinyinPro.pinyin(n, { pattern: 'first', toneType: 'none' }) || '')
                .replace(/\s/g, '').toLowerCase();
            if (pyFirst.indexOf(q) !== -1) return true;
            var pyInitial = (pinyinPro.pinyin(n, { pattern: 'initial', toneType: 'none' }) || '')
                .replace(/\s/g, '').toLowerCase();
            if (pyInitial.indexOf(q) !== -1) return true;
            var pyFull = (pinyinPro.pinyin(n, { toneType: 'none' }) || '').replace(/\s/g, '').toLowerCase();
            if (pyFull.indexOf(q) !== -1) return true;
        } catch (e) {}
    }
    return false;
}

function searchSchools(query) {
    var q = (query || '').trim();
    if (!q) return [];
    var list = [];
    (schoolsData.primarySchools || []).forEach(function(s) {
        if (fuzzyMatchName(s.name, q)) list.push({ item: s, type: 'primary', name: s.name });
    });
    (schoolsData.middleSchools || []).forEach(function(s) {
        if (fuzzyMatchName(s.name, q)) list.push({ item: s, type: 'middle', name: s.name });
    });
    return list;
}

function searchLoupans(query) {
    var q = (query || '').trim();
    if (!q) return [];
    var list = [];
    (loupanData.loupanList || []).forEach(function(l) {
        if (fuzzyMatchName(l.name, q)) list.push({ item: l, name: l.name });
    });
    return list;
}

// 判断点是否在多边形内（与 school.js 一致）
function isPointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    var x = point[0], y = point[1];
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        var xi = polygon[i][0], yi = polygon[i][1];
        var xj = polygon[j][0], yj = polygon[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// 根据楼盘经纬度判断落在哪些学校学区内，返回可读的小学、初中列表
function getSchoolsForLoupan(loupan) {
    var point = [loupan.coordinates[0], loupan.coordinates[1]];
    var primary = [];
    var middle = [];
    (schoolsData.primarySchools || []).forEach(function(school) {
        var path = getSchoolDistrictPath(school);
        if (path && isPointInPolygon(point, path)) primary.push(school);
    });
    (schoolsData.middleSchools || []).forEach(function(school) {
        var path = getSchoolDistrictPath(school);
        if (path && isPointInPolygon(point, path)) middle.push(school);
    });
    return { primary: primary, middle: middle };
}

// 创建学校点位 DOM（与 school 页面一致：文字在上、点在下，小学绿色、中学红色）
function createSchoolMarkerContent(school, type) {
    var cls = type === 'primary' ? 'primary' : 'middle';
    var name = escapeHtml(school.name);
    return '<div class="school-marker ' + cls + '">' +
        '<div class="marker-text">' + name + '</div>' +
        '<div class="marker-pin"></div>' +
        '</div>';
}

// 显示学区学校点位（小学绿色、中学红色）
function showSchoolMarkers(schools) {
    clearSchoolMarkers();
    (schools.primary || []).forEach(function(school) {
        var content = createSchoolMarkerContent(school, 'primary');
        var marker = new AMap.Marker({
            position: school.coordinates,
            content: content,
            anchor: 'bottom-center'
        });
        map.add(marker);
        currentSchoolMarkers.push(marker);
    });
    (schools.middle || []).forEach(function(school) {
        var content = createSchoolMarkerContent(school, 'middle');
        var marker = new AMap.Marker({
            position: school.coordinates,
            content: content,
            anchor: 'bottom-center'
        });
        map.add(marker);
        currentSchoolMarkers.push(marker);
    });
}

function clearSchoolMarkers() {
    currentSchoolMarkers.forEach(function(m) {
        map.remove(m);
    });
    currentSchoolMarkers = [];
}

// 计算两点距离（公里），Haversine
function getDistanceKm(lng1, lat1, lng2, lat2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 周边配套类型配置：高德风格图标与颜色（参考 ditu.amap.com）
var POI_CONFIG = {
    subway:   { label: '地铁',   icon: '铁', color: '#0091FF' },
    commerce: { label: '商业',   icon: '商', color: '#FF6B00' },
    park:     { label: '公园',   icon: '公', color: '#52C41A' },
    municipal:{ label: '政府',   icon: '政', color: '#CF1322' },
    hospital: { label: '医院',   icon: '医', color: '#E74C3C' }
};

// 按距离筛选楼盘周边配套（默认 3km）
function getNearbyPois(loupan, radiusKm) {
    radiusKm = radiusKm || 3;
    var lng = loupan.coordinates[0];
    var lat = loupan.coordinates[1];
    var filter = function(list) {
        return (list || []).filter(function(item) {
            var c = item.coordinates;
            if (!c || c.length < 2) return false;
            return getDistanceKm(lng, lat, c[0], c[1]) <= radiusKm;
        });
    };
    return {
        subway:   filter(loupanData.subwayList),
        commerce: filter(loupanData.commerceList),
        park:     filter(loupanData.parkList),
        hospital: filter(loupanData.hospitalList),
        municipal:filter(loupanData.municipalList)
    };
}

// 创建单个配套点位 DOM（与楼盘点位一致：文字在上、点在下，点内为类型图标）
function createPoiMarkerContent(item, typeKey) {
    var cfg = POI_CONFIG[typeKey] || { icon: '', color: '#666' };
    var name = escapeHtml(item.name);
    var icon = cfg.icon;
    return '<div class="poi-marker poi-' + typeKey + '">' +
        '<div class="marker-text">' + name + '</div>' +
        '<div class="marker-pin" data-icon="' + escapeHtml(icon) + '"></div>' +
        '</div>';
}

// 显示周边配套点位（pois 为按类型分组的对象，只展示有传入的类型）
function showPoiMarkers(pois) {
    clearPoiMarkers();
    var types = [
        { key: 'subway',   list: pois.subway },
        { key: 'commerce', list: pois.commerce },
        { key: 'park',     list: pois.park },
        { key: 'hospital', list: pois.hospital },
        { key: 'municipal',list: pois.municipal }
    ];
    types.forEach(function(t) {
        (t.list || []).forEach(function(item) {
            var content = createPoiMarkerContent(item, t.key);
            var marker = new AMap.Marker({
                position: item.coordinates,
                content: content,
                anchor: 'bottom-center'
            });
            map.add(marker);
            currentPoiMarkers.push(marker);
        });
    });
}

// 根据当前筛选状态刷新配套与学校点位（仅在有 currentLoupan 时有效）
function refreshMarkersByFilter() {
    if (!currentLoupan || !map) return;
    var nearby = getNearbyPois(currentLoupan);
    var schools = getSchoolsForLoupan(currentLoupan);
    var filteredPois = {
        subway:   filterState.subway   ? (nearby.subway   || []) : [],
        commerce: filterState.commerce ? (nearby.commerce || []) : [],
        park:     filterState.park     ? (nearby.park     || []) : [],
        hospital: filterState.hospital ? (nearby.hospital || []) : [],
        municipal: filterState.municipal ? (nearby.municipal || []) : []
    };
    var filteredSchools = {
        primary: filterState.primary ? (schools.primary || []) : [],
        middle:  filterState.middle  ? (schools.middle  || []) : []
    };
    showPoiMarkers(filteredPois);
    showSchoolMarkers(filteredSchools);
}

function clearPoiMarkers() {
    currentPoiMarkers.forEach(function(m) {
        map.remove(m);
    });
    currentPoiMarkers = [];
}

// 获取楼盘多边形路径（district.polygon 第一环为外轮廓，与 school 一致）
function getLoupanPath(loupan) {
    const d = loupan.district;
    if (!d || !d.polygon || !Array.isArray(d.polygon) || d.polygon.length === 0) return null;
    const ring = d.polygon[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring;
}

// 创建楼盘点位：蓝色点 + 楼盘名字；可选仅显示学区内的楼盘
function initLoupanMarkers() {
    if (!map || typeof AMap === 'undefined') return;
    clearLoupanMarkers();
    closeLoupanView();
    currentSchoolDistrictPolygon = null;
    currentSchoolDistrictPath = null;
    currentSchoolDistrictSchool = null;

    loupanData.loupanList.forEach(function(loupan) {
        var markerContent =
            '<div class="loupan-marker">' +
            '<div class="marker-text">' + escapeHtml(loupan.name) + '</div>' +
            '<div class="marker-pin"></div>' +
            '</div>';
        var marker = new AMap.Marker({
            position: loupan.coordinates,
            content: markerContent,
            anchor: 'bottom-center'
        });
        var key = loupan.id || loupan.name;
        marker.on('click', function() {
            showLoupanPolygon(loupan, key);
        });
        loupanMarkers.push({ marker: marker, loupan: loupan, key: key });
        map.add(marker);
    });
}

// 根据当前学区筛选：只显示学区内的楼盘点位；无学区时显示全部
function refreshLoupanMarkersVisibility() {
    if (!map) return;
    var path = currentSchoolDistrictPath;
    loupanMarkers.forEach(function(item) {
        var show = !path || isPointInPolygon([item.loupan.coordinates[0], item.loupan.coordinates[1]], path);
        if (show) map.add(item.marker);
        else map.remove(item.marker);
    });
}

// 选择学校：显示学区多边形，只显示学区内楼盘，地图视野包含学区
function showSchoolDistrict(school, type) {
    var path = getSchoolDistrictPath(school);
    if (!path || path.length < 3) return;
    closeLoupanView();
    if (currentSchoolDistrictPolygon) {
        map.remove(currentSchoolDistrictPolygon);
        currentSchoolDistrictPolygon = null;
    }
    currentSchoolDistrictPath = path;
    currentSchoolDistrictSchool = { school: school, type: type };
    var strokeColor = type === 'primary' ? '#28a745' : '#e74c3c';
    var fillColor = type === 'primary' ? '#28a745' : '#e74c3c';
    currentSchoolDistrictPolygon = new AMap.Polygon({
        path: path,
        strokeColor: strokeColor,
        strokeWeight: 2,
        strokeOpacity: 1,
        fillColor: fillColor,
        fillOpacity: 0.2,
        zIndex: 70
    });
    map.add(currentSchoolDistrictPolygon);
    refreshLoupanMarkersVisibility();
    map.setFitView([currentSchoolDistrictPolygon], false, [40, 40, 40, 40]);
}

// 选择楼盘（来自搜索）：地图居中到该楼盘
function centerMapOnLoupan(loupan) {
    if (!map || !loupan || !loupan.coordinates) return;
    map.setCenter(loupan.coordinates);
    map.setZoom(16);
}

// 显示楼盘多边形：绘制多边形，隐藏其他楼盘点位，显示退出按钮
function showLoupanPolygon(loupan, key) {
    const path = getLoupanPath(loupan);
    if (!path) return;

    closeLoupanView();

    const strokeColor = '#285FF5';
    const fillColor = '#285FF5';
    currentLoupanPolygon = new AMap.Polygon({
        path: path,
        strokeColor: strokeColor,
        strokeWeight: 2,
        strokeOpacity: 1,
        fillColor: fillColor,
        fillOpacity: 0.25,
        zIndex: 80
    });
    map.add(currentLoupanPolygon);
    currentLoupanKey = key;

    loupanMarkers.forEach(function(item) {
        if (item.key !== key) map.remove(item.marker);
    });

    currentLoupan = loupan;
    syncFilterCheckboxes();
    refreshMarkersByFilter();

    var btn = document.getElementById('close-district-btn');
    if (btn) btn.classList.add('visible');
    var filterPanel = document.getElementById('filter-panel');
    if (filterPanel) filterPanel.classList.add('visible');
}

// 关闭楼盘范围：移除楼盘多边形与配套点位，保留学区边框，只显示学区内楼盘
function closeLoupanView() {
    if (currentLoupanPolygon) {
        map.remove(currentLoupanPolygon);
        currentLoupanPolygon = null;
    }
    currentLoupanKey = null;
    currentLoupan = null;
    clearPoiMarkers();
    clearSchoolMarkers();
    refreshLoupanMarkersVisibility();
    var btn = document.getElementById('close-district-btn');
    if (btn) btn.classList.remove('visible');
    var filterPanel = document.getElementById('filter-panel');
    if (filterPanel) filterPanel.classList.remove('visible');
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function clearLoupanMarkers() {
    if (currentLoupanPolygon) {
        map.remove(currentLoupanPolygon);
        currentLoupanPolygon = null;
    }
    currentLoupanKey = null;
    clearPoiMarkers();
    clearSchoolMarkers();
    var btn = document.getElementById('close-district-btn');
    if (btn) btn.classList.remove('visible');
    loupanMarkers.forEach(function(item) {
        map.remove(item.marker);
    });
    loupanMarkers = [];
}

function initCloseDistrictButton() {
    var btn = document.getElementById('close-district-btn');
    if (btn) btn.addEventListener('click', closeLoupanView);
}

// 将 filterState 同步到筛选框复选框
function syncFilterCheckboxes() {
    var panel = document.getElementById('filter-panel');
    if (!panel) return;
    panel.querySelectorAll('input[type="checkbox"][data-type]').forEach(function(cb) {
        var type = cb.getAttribute('data-type');
        if (filterState.hasOwnProperty(type)) cb.checked = filterState[type];
    });
}

// 初始化配套筛选框：勾选变化时更新 filterState 并刷新地图点位
function initFilterPanel() {
    var panel = document.getElementById('filter-panel');
    if (!panel) return;
    panel.querySelectorAll('input[type="checkbox"][data-type]').forEach(function(cb) {
        cb.addEventListener('change', function() {
            var type = cb.getAttribute('data-type');
            if (filterState.hasOwnProperty(type)) {
                filterState[type] = cb.checked;
                refreshMarkersByFilter();
            }
        });
    });
}

// 绘图功能初始化（与 school 一致：开启绘图、清除绘图、颜色选择）
function initDrawingTools() {
    var startDrawBtn = document.getElementById('start-draw');
    var clearDrawBtn = document.getElementById('clear-draw');
    var colorPanel = document.getElementById('color-panel');
    var canvas = document.getElementById('draw-canvas');
    var ctx = canvas.getContext('2d');

    var isDrawing = false;
    var drawingEnabled = false;
    var currentColor = '#285FF5';
    var lastX = 0;
    var lastY = 0;

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = currentColor;
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    startDrawBtn.addEventListener('click', function() {
        drawingEnabled = !drawingEnabled;
        if (drawingEnabled) {
            canvas.classList.add('drawing');
            colorPanel.classList.remove('hidden');
            startDrawBtn.textContent = '关闭绘图';
            startDrawBtn.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)';
        } else {
            canvas.classList.remove('drawing');
            colorPanel.classList.add('hidden');
            startDrawBtn.textContent = '开启绘图';
            startDrawBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            isDrawing = false;
        }
    });

    clearDrawBtn.addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    document.querySelectorAll('.color-option').forEach(function(option) {
        option.addEventListener('click', function() {
            document.querySelector('.color-option.selected').classList.remove('selected');
            this.classList.add('selected');
            currentColor = this.dataset.color;
            ctx.strokeStyle = currentColor;
        });
    });

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

    canvas.addEventListener('touchstart', handleTouch);
    canvas.addEventListener('touchmove', handleTouch);
    canvas.addEventListener('touchend', stopDraw);

    function startDraw(e) {
        if (!drawingEnabled) return;
        isDrawing = true;
        var rect = canvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
    }

    function draw(e) {
        if (!isDrawing || !drawingEnabled) return;
        var rect = canvas.getBoundingClientRect();
        var currentX = e.clientX - rect.left;
        var currentY = e.clientY - rect.top;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        lastX = currentX;
        lastY = currentY;
    }

    function stopDraw() {
        isDrawing = false;
    }

    function handleTouch(e) {
        e.preventDefault();
        var touch = e.touches[0];
        var mouseEvent = new MouseEvent(
            e.type === 'touchstart' ? 'mousedown' : e.type === 'touchmove' ? 'mousemove' : 'mouseup',
            { clientX: touch.clientX, clientY: touch.clientY }
        );
        canvas.dispatchEvent(mouseEvent);
    }
}

// 初始化搜索框：默认搜学校，可切换搜楼盘；模糊匹配；选学校显示学区并联动楼盘，选楼盘居中
function initSearchBox() {
    var input = document.getElementById('search-input');
    var toggle = document.getElementById('search-toggle');
    var dropdown = document.getElementById('search-dropdown');
    if (!input || !toggle || !dropdown) return;

    function updatePlaceholder() {
        input.placeholder = searchMode === 'school' ? '搜索学校名称' : '搜索楼盘名称';
        toggle.textContent = searchMode === 'school' ? '学校' : '楼盘';
    }

    function renderDropdown(list) {
        dropdown.innerHTML = '';
        if (!list || list.length === 0) {
            dropdown.classList.add('visible');
            var empty = document.createElement('div');
            empty.className = 'search-dropdown-empty';
            empty.textContent = '无匹配结果';
            dropdown.appendChild(empty);
            return;
        }
        dropdown.classList.add('visible');
        list.slice(0, 50).forEach(function(entry) {
            var div = document.createElement('div');
            div.className = 'search-dropdown-item';
            div.textContent = entry.name;
            div.addEventListener('click', function() {
                dropdown.classList.remove('visible');
                input.value = '';
                if (searchMode === 'school') {
                    showSchoolDistrict(entry.item, entry.type);
                } else {
                    centerMapOnLoupan(entry.item);
                }
            });
            dropdown.appendChild(div);
        });
    }

    toggle.addEventListener('click', function() {
        searchMode = searchMode === 'school' ? 'loupan' : 'school';
        updatePlaceholder();
        input.value = '';
        dropdown.classList.remove('visible');
    });

    input.addEventListener('input', function() {
        var q = input.value.trim();
        if (!q) {
            dropdown.classList.remove('visible');
            return;
        }
        var list = searchMode === 'school' ? searchSchools(q) : searchLoupans(q);
        renderDropdown(list);
    });

    input.addEventListener('focus', function() {
        var q = input.value.trim();
        if (q) {
            var list = searchMode === 'school' ? searchSchools(q) : searchLoupans(q);
            renderDropdown(list);
        }
    });

    document.addEventListener('click', function(e) {
        var box = document.getElementById('search-box');
        if (box && !box.contains(e.target)) dropdown.classList.remove('visible');
    });

    updatePlaceholder();
}

document.addEventListener('DOMContentLoaded', function() {
    var center = [113.912965, 22.568960];
    initMap(center);

    map.on('complete', function() {
        loadLoupanData();
        loadSchoolData();
        initCloseDistrictButton();
        initFilterPanel();
        initSearchBox();
        setTimeout(function() {
            initDrawingTools();
        }, 500);
    });
});

document.addEventListener('touchmove', function(e) {
    if (e.target === document.getElementById('draw-canvas')) {
        e.preventDefault();
    }
}, { passive: false });
