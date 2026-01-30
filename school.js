// 全局变量
let map;
let schoolMarkers = []; // 项为 { marker, school, type }
let schoolsData = { primarySchools: [], middleSchools: [] };
let currentZoom = 16;
let currentDistrictPolygon = null;
let currentDistrictSchoolKey = null;
let pickLocationMode = false;
let pickLocationMarker = null;
let pickLocationClickListener = null;

// 初始化3D地图
function initMap(center) {
    map = new AMap.Map('map', {
        zooms: [13.5,22],
        zoom: 16,
        center: center,
        viewMode: '3D',           // 启用3D模式
        terrain: true,            // 启用地形
        pitch: 0,                // 设置地图俯仰角度(0-83度)
        rotation: 0,              // 设置地图旋转角度(0-360度)
        scrollWheel: true,        // 启用鼠标滚轮缩放
        zoomEnable: true,         // 启用缩放
        doubleClickZoom: true,    // 启用双击缩放
        dragEnable: true,         // 启用拖拽
        pitchEnable: false,        // 启用俯仰角调节（3D模式关键配置）
        rotateEnable: false,       // 启用旋转（3D模式关键配置）
        // 禁用高德地图自带的3D建筑
        showBuildingBlock: false,
        showLabel: true
    });

    // 添加3D控件（右上角，绘图按钮下方）
    const controlBar = new AMap.ControlBar({
        position: {
            top: '100px',
            right: '20px'
        },
        showZoomBar: true,
        showControlButton: true
    });
    map.addControl(controlBar);

    // 添加比例尺控件（左下角）
    const scale = new AMap.Scale({
        position: 'LB'
    });
    map.addControl(scale);

    // 添加工具栏控件（右下角，缩放控件上方）
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

    // 监听缩放，用于文字大小显示逻辑（与 index 一致）
    map.on('zoomend', onSchoolZoomChange);
}

// 加载学校数据
async function loadSchoolData() {
    try {
        const res = await fetch('school.json');
        if (res.ok) {
            schoolsData = await res.json();
            schoolsData.primarySchools = schoolsData.primarySchools || [];
            schoolsData.middleSchools = schoolsData.middleSchools || [];
            initSchoolMarkers();
        }
    } catch (e) {
        console.error('加载 school.json 失败', e);
    }
}

// 获取学校学区路径（district.polygon 第一环为外轮廓）
function getDistrictPath(school) {
    const d = school.district;
    if (!d || !d.polygon || !Array.isArray(d.polygon) || d.polygon.length === 0) return null;
    const ring = d.polygon[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring;
}

// 创建学校点位：格式与 index 小区一致——先有一个点位，上面显示名字；小学绿色，中学橙红色
function initSchoolMarkers() {
    if (!map || typeof AMap === 'undefined') return;
    clearSchoolMarkers();
    closeDistrictView();

    const addSchool = (school, type) => {
        const cls = type === 'primary' ? 'primary' : 'middle';
        const markerContent = `
            <div class="school-marker ${cls}">
                <div class="marker-text">${escapeHtml(school.name)}</div>
                <div class="marker-pin"></div>
            </div>
        `;
        const marker = new AMap.Marker({
            position: school.coordinates,
            content: markerContent,
            anchor: 'bottom-center'
        });
        const key = (type === 'primary' ? 'p:' : 'm:') + (school.id || school.name);
        marker.on('click', () => showSchoolDistrict(school, type, key));
        schoolMarkers.push({ marker, school, type, key });
        map.add(marker);
    };

    schoolsData.primarySchools.forEach(s => addSchool(s, 'primary'));
    schoolsData.middleSchools.forEach(s => addSchool(s, 'middle'));
}

// 显示某学校的学区范围：绘制多边形，隐藏其他学校名称，显示退出按钮
function showSchoolDistrict(school, type, key) {
    const path = getDistrictPath(school);
    if (!path) return;

    closeDistrictView();

    const strokeColor = type === 'primary' ? '#28a745' : '#e74c3c';
    const fillColor = type === 'primary' ? '#28a745' : '#e74c3c';
    currentDistrictPolygon = new AMap.Polygon({
        path: path,
        strokeColor: strokeColor,
        strokeWeight: 2,
        strokeOpacity: 1,
        fillColor: fillColor,
        fillOpacity: 0.25,
        zIndex: 80
    });
    map.add(currentDistrictPolygon);
    currentDistrictSchoolKey = key;

    schoolMarkers.forEach(({ marker, key: k }) => {
        if (k !== key) map.remove(marker);
    });

    const btn = document.getElementById('close-district-btn');
    if (btn) btn.classList.add('visible');
}

// 关闭学区查看：移除多边形、恢复所有学校名称、隐藏退出按钮
function closeDistrictView() {
    if (currentDistrictPolygon) {
        map.remove(currentDistrictPolygon);
        currentDistrictPolygon = null;
    }
    currentDistrictSchoolKey = null;
    schoolMarkers.forEach(({ marker }) => map.add(marker));
    const btn = document.getElementById('close-district-btn');
    if (btn) btn.classList.remove('visible');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function clearSchoolMarkers() {
    if (currentDistrictPolygon) {
        map.remove(currentDistrictPolygon);
        currentDistrictPolygon = null;
    }
    currentDistrictSchoolKey = null;
    const btn = document.getElementById('close-district-btn');
    if (btn) btn.classList.remove('visible');
    schoolMarkers.forEach(({ marker }) => map.remove(marker));
    schoolMarkers = [];
}

function onSchoolZoomChange() {
    currentZoom = map.getZoom();
}

// 判断点是否在多边形内（用于点选位置查询学区）
function isPointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// 根据经纬度点计算所在的所有小学、初中学区学校（一个点位可对应多所）
function getSchoolsAtPoint(lngLat) {
    const point = [lngLat.lng, lngLat.lat];
    const primaryNames = [];
    const middleNames = [];
    schoolsData.primarySchools.forEach(school => {
        const path = getDistrictPath(school);
        if (path && isPointInPolygon(point, path)) primaryNames.push(school.name);
    });
    schoolsData.middleSchools.forEach(school => {
        const path = getDistrictPath(school);
        if (path && isPointInPolygon(point, path)) middleNames.push(school.name);
    });
    return { primaryNames, middleNames };
}

// 显示点选位置结果框（支持多所小学、多所初中）
function showLocationResult(primaryNames, middleNames) {
    const box = document.getElementById('location-result-box');
    const primaryEl = document.getElementById('result-primary-name');
    const middleEl = document.getElementById('result-middle-name');
    if (box && primaryEl && middleEl) {
        primaryEl.textContent = primaryNames.length > 0 ? primaryNames.join('、') : '未在学区内';
        middleEl.textContent = middleNames.length > 0 ? middleNames.join('、') : '未在学区内';
        box.classList.add('visible');
    }
}

function hideLocationResult() {
    const box = document.getElementById('location-result-box');
    if (box) box.classList.remove('visible');
}

// 点选位置模式：地图点击后计算学区并显示结果
function onMapClickForPick(e) {
    if (!pickLocationMode || !e.lnglat) return;
    const lnglat = e.lnglat;
    if (pickLocationMarker) {
        map.remove(pickLocationMarker);
        pickLocationMarker = null;
    }
    pickLocationMarker = new AMap.Marker({
        position: [lnglat.lng, lnglat.lat],
        content: '<div style="width:16px;height:16px;border-radius:50%;background:#285FF5;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>',
        anchor: 'center'
    });
    map.add(pickLocationMarker);
    const { primaryNames, middleNames } = getSchoolsAtPoint(lnglat);
    showLocationResult(primaryNames, middleNames);
}

function setPickLocationMode(enable) {
    pickLocationMode = enable;
    const btn = document.getElementById('pick-location-btn');
    if (btn) {
        if (enable) {
            btn.classList.add('active');
            btn.textContent = '点选中… 点击地图';
            if (!pickLocationClickListener) {
                pickLocationClickListener = (e) => onMapClickForPick(e);
                map.on('click', pickLocationClickListener);
            }
        } else {
            btn.classList.remove('active');
            btn.textContent = '点选位置';
            if (pickLocationClickListener) {
                map.off('click', pickLocationClickListener);
                pickLocationClickListener = null;
            }
            if (pickLocationMarker) {
                map.remove(pickLocationMarker);
                pickLocationMarker = null;
            }
        }
    }
}

function initPickLocation() {
    const btn = document.getElementById('pick-location-btn');
    const closeResultBtn = document.getElementById('close-result-box');
    if (btn) {
        btn.addEventListener('click', () => {
            setPickLocationMode(!pickLocationMode);
        });
    }
    if (closeResultBtn) {
        closeResultBtn.addEventListener('click', () => {
            hideLocationResult();
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 免责声明弹窗：点击关闭后正常使用页面
    const disclaimerModal = document.getElementById('disclaimer-modal');
    const disclaimerCloseBtn = document.getElementById('disclaimer-close-btn');
    if (disclaimerCloseBtn && disclaimerModal) {
        disclaimerCloseBtn.addEventListener('click', function() {
            disclaimerModal.classList.add('hidden');
        });
    }

    // 使用指定的中心点初始化地图
    const center = [113.912965, 22.568960];
    
    initMap(center);
    
    // 等待地图加载完成后初始化绘图功能
    map.on('complete', function() {
        loadSchoolData();
        initCloseDistrictButton();
        initPickLocation();
        setTimeout(() => {
            initDrawingTools();
        }, 500);
    });
});

function initCloseDistrictButton() {
    const btn = document.getElementById('close-district-btn');
    if (btn) btn.addEventListener('click', closeDistrictView);
}

// 绘图功能初始化
function initDrawingTools() {
    const startDrawBtn = document.getElementById('start-draw');
    const clearDrawBtn = document.getElementById('clear-draw');
    const colorPanel = document.getElementById('color-panel');
    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');
    
    let isDrawing = false;
    let drawingEnabled = false;
    let currentColor = '#285FF5';
    let lastX = 0;
    let lastY = 0;

    // 设置canvas尺寸
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

    // 开启/关闭绘图
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

    // 清除绘图
    clearDrawBtn.addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    // 颜色选择
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelector('.color-option.selected').classList.remove('selected');
            this.classList.add('selected');
            currentColor = this.dataset.color;
            ctx.strokeStyle = currentColor;
        });
    });

    // 鼠标绘图事件
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

    // 触摸绘图事件（移动端）
    canvas.addEventListener('touchstart', handleTouch);
    canvas.addEventListener('touchmove', handleTouch);
    canvas.addEventListener('touchend', stopDraw);

    function startDraw(e) {
        if (!drawingEnabled) return;
        isDrawing = true;
        [lastX, lastY] = getCoordinates(e);
    }

    function draw(e) {
        if (!isDrawing || !drawingEnabled) return;
        
        const [currentX, currentY] = getCoordinates(e);
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        
        [lastX, lastY] = [currentX, currentY];
    }

    function stopDraw() {
        isDrawing = false;
    }

    function handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent(e.type === 'touchstart' ? 'mousedown' : 
                                        e.type === 'touchmove' ? 'mousemove' : 'mouseup', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
    }

    function getCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        return [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
    }
}

// 防止页面滚动（移动端）
document.addEventListener('touchmove', function(e) {
    if (e.target === document.getElementById('draw-canvas')) {
        e.preventDefault();
    }
}, { passive: false });
