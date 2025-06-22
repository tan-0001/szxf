// 全局变量
let map;
let projectData = null;
let projectName = '';

// Three.js相关变量
let scene, camera, renderer;
let labelGroup;
let customLayer;
let currentZoomLevel = 16;

// 全局3D楼栋mesh数组
let buildingMeshes = [];

// CSS2D渲染器用于HTML标注
let labelRenderer;
let renderDebounceTimer;



// 获取URL参数
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// 加载项目数据
async function loadProjectData(projectName) {
    // 对中文文件夹名进行URL编码
    const encodedProjectName = encodeURIComponent(projectName);
    const filePath = `data/${encodedProjectName}/buildings.json`;
    
    try {
        const response = await fetch(filePath);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('加载项目数据失败:', error.message);
        throw error;
    }
}

// 初始化3D地图
function initMap(center) {
    map = new AMap.Map('map', {
        zooms: [15,20],
        zoom: 16,
        center: center,
        viewMode: '3D',           // 启用3D模式
        terrain: true,            // 启用地形
        pitch: 30,                // 设置地图俯仰角度(0-83度)
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

    // 初始化3D对象图层
    init3DLayer();

    // 监听地图缩放事件
    map.on('zoomend', function() {
        currentZoomLevel = map.getZoom();
        updateLabelsVisibility();
        update3DBuildingsVisibility();
    });
}

// 初始化3D对象图层（改用Three.js）
function init3DLayer() {
    console.log('开始初始化Three.js图层...');
    
    try {
        // 创建Three.js图层
        object3DLayer = new AMap.ThreeLayer(map);
        
        object3DLayer.on('complete', function() {
            console.log('Three.js图层初始化完成');
            
            // 添加环境光
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            object3DLayer.add(ambientLight);
            
            // 添加方向光
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(1, 1, 1);
            object3DLayer.add(directionalLight);
            
            console.log('Three.js图层光照设置完成');
        });
        
    } catch (error) {
        console.error('Three.js图层初始化失败:', error);
    }
}

// 坐标转换系统
class CoordinateSystem {
    constructor(threeLayer) {
        this.threeLayer = threeLayer;
        this.cache = new Map(); // 坐标缓存
    }

    // 经纬度转世界坐标
    convertLngLatToWorld(lngLat, height = 0) {
        const key = `${lngLat[0]},${lngLat[1]},${height}`;
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const worldPos = this.threeLayer.convertLngLat(lngLat);
        const result = [worldPos[0], worldPos[1], height];
        this.cache.set(key, result);
        return result;
    }

    // 世界坐标转经纬度
    convertWorldToLngLat(worldPos) {
        return this.threeLayer.convertWorldToLngLat(worldPos);
    }

    // 清除缓存
    clearCache() {
        this.cache.clear();
    }
}



// ================== 优化后的标签系统 ==================

// 同步控制系统
class SyncSystem {
    constructor(map) {
        this.map = map;
        this.isMoving = false;
        this.stabilizeTimer = null;
        this.renderCount = 0;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.map.on('movestart', () => {
            this.isMoving = true;
            if (this.stabilizeTimer) clearTimeout(this.stabilizeTimer);
        });

        this.map.on('moveend', () => {
            this.isMoving = false;
            this.stabilizeRendering();
        });

        this.map.on('zoomstart', () => {
            this.isMoving = true;
        });

        this.map.on('zoomend', () => {
            this.isMoving = false;
            this.stabilizeRendering();
        });
    }

    stabilizeRendering() {
        this.stabilizeTimer = setTimeout(() => {
            console.log('地图移动结束，稳定化渲染');
            for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                    this.forceUpdate();
                }, i * 16.67);
            }
        }, 100);
    }

    forceUpdate() {
        try {
            updateLabelsVisibility();
            this.renderCount++;
        } catch (error) {
            console.error('稳定化渲染出错:', error);
        }
    }
}

// 初始化系统
function initSystems() {
    const coordinateSystem = new CoordinateSystem(object3DLayer);
    const syncSystem = new SyncSystem(map);
    return {
        coordinateSystem,
        syncSystem
    };
}



// 修改create3DBuildings函数，控制分割线可见性
function create3DBuildings() {
    if (!projectData || !projectData.buildings || !object3DLayer) {
        console.log('项目数据或3D图层未准备好，跳过楼栋创建');
        return;
    }

    const systems = initSystems();
    
    console.log('开始创建3D楼栋...', projectData.buildings.length, '个楼栋');
    
    let successCount = 0;
    let errorCount = 0;
    
    buildingMeshes = [];
    
    // 创建所有楼栋主体和户型
    projectData.buildings.forEach((building, index) => {
        if (building.polygon && building.polygon.length > 0) {
            try {
                console.log(`开始创建楼栋 ${building.name}:`, {
                    height: building.height,
                    baseHeight: building.baseHeight,
                    floorHeight: building.floorHeight,
                    facadeColor: building.facadeColor,
                    floorLineColor: building.floorLineColor
                });
                
                const buildingGroup = createBuildingMesh(building);
                if (buildingGroup) {
                    object3DLayer.add(buildingGroup);
                
                    buildingMeshes.push({
                        mesh: buildingGroup,
                        building: building,
                        visible: true
                    });
                
                    successCount++;
                    console.log(`楼栋 ${building.name} 创建成功`);
                } else {
                    errorCount++;
                    console.error(`楼栋 ${building.name} 创建失败`);
                }
            } catch (error) {
                console.error(`创建楼栋 ${building.name} 时出错:`, error);
                errorCount++;
            }
        }
    });
    
    console.log(`3D楼栋创建完成: 成功 ${successCount} 个, 失败 ${errorCount} 个`);
    
    // 立即更新可见性
    update3DBuildingsVisibility();
}

// 辅助函数：计算多边形经纬度中心
function getPolygonLngLatCenter(polygon) {
    let lngSum = 0, latSum = 0;
    polygon.forEach(coord => {
        lngSum += coord[0];
        latSum += coord[1];
    });
    return [lngSum / polygon.length, latSum / polygon.length];
}

// 在createBuildingMesh中添加红点标注
function createBuildingMesh(building) {
    try {
        console.log(`创建楼栋: ${building.name}`);
        
        // 获取楼栋参数
        const polygon = building.polygon;
        const totalHeight = building.height || 30; // 总高度
        const baseHeight = building.baseHeight || 0; // 起始高度
        const floorCount = building.floorCount || 10;
        const floorHeight = building.floorHeight || 3;
        const facadeColor = building.facadeColor || '#6699cc';
        const floorLineColor = building.floorLineColor || '#ffffff';
        
        // 计算实际建模高度
        const modelingHeight = totalHeight - baseHeight;
        
        console.log(`楼栋参数: 总高度${totalHeight}米, 起始高度${baseHeight}米, 建模高度${modelingHeight}米`);
        
        if (modelingHeight <= 0) {
            console.warn(`楼栋 ${building.name} 的建模高度为${modelingHeight}米，无法创建建筑`);
            return null;
        }
        
        // 创建建筑群组
        const buildingGroup = new THREE.Group();
        
        // 1. 创建楼栋主体（使用多几何体方法）
        const mainBuilding = createBuildingBodyWithFloorLines(polygon, building.center, baseHeight, modelingHeight, facadeColor, floorLineColor, floorHeight, building.name);
        if (mainBuilding) {
            buildingGroup.add(mainBuilding);
        }
        
        // 2. 创建顶部户型多边形
        if (building.units && building.units.length > 0) {
            console.log(`楼栋 ${building.name} 开始创建户型多边形，户型数量: ${building.units.length}`);
            const unitPolygons = createUnitPolygons(building.units, totalHeight, building.name);
            let addedUnits = 0;
            unitPolygons.forEach(polygon => {
                if (polygon) {
                    buildingGroup.add(polygon);
                    addedUnits++;
                }
            });
            console.log(`楼栋 ${building.name} 成功添加 ${addedUnits} 个户型多边形到建筑群组`);
        } else {
            console.log(`楼栋 ${building.name} 没有户型信息，跳过户型多边形创建`);
        }
        
        
        // 设置用户数据
        buildingGroup.userData = {
            name: building.name,
            building: building,
            totalHeight: totalHeight,
            baseHeight: baseHeight,
            modelingHeight: modelingHeight
        };
        
        console.log(`楼栋 ${building.name} 创建完成: 群组包含 ${buildingGroup.children.length} 个子对象`);
        return buildingGroup;
        
    } catch (error) {
        console.error(`创建楼栋 ${building.name} 时出错:`, error);
        return null;
    }
}

// 创建带楼层分割线的楼栋主体（使用多几何体方法）
function createBuildingBodyWithFloorLines(polygon, center, baseHeight, height, facadeColor, floorLineColor, floorHeight, name) {
    try {
        // 直接用世界坐标建模
        const points = polygon.map(coord => {
            const worldPos = object3DLayer.convertLngLat(coord);
            return new THREE.Vector2(worldPos[0], worldPos[1]);
        });
        const shape = new THREE.Shape(points);
        const buildingGroup = new THREE.Group();
        // 主体
        const mainGeometry = new THREE.ExtrudeGeometry(shape, {
            depth: height,
            bevelEnabled: false
        });
        const mainMaterial = new THREE.MeshLambertMaterial({
            color: facadeColor,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide
        });
        const mainMesh = new THREE.Mesh(mainGeometry, mainMaterial);
        mainMesh.position.z = baseHeight; // 让楼栋从baseHeight开始
        buildingGroup.add(mainMesh);
        // 简化分割线：用THREE.Line绘制每层闭合多边形
        const floorCount = Math.floor(height / floorHeight) - 1;
        for (let i = 1; i <= floorCount; i++) {
            const z = baseHeight + i * floorHeight;
            const layerPoints = points.map(p => new THREE.Vector3(p.x, p.y, z));
            layerPoints.push(new THREE.Vector3(points[0].x, points[0].y, z)); // 闭合
            const geometry = new THREE.BufferGeometry().setFromPoints(layerPoints);
            const material = new THREE.LineBasicMaterial({ color: floorLineColor });
            const line = new THREE.Line(geometry, material);
            buildingGroup.add(line);
        }
        // 只做Z轴平移
        buildingGroup.position.set(0, 0, 0);
        buildingGroup.userData = {
            type: 'building',
            name: name,
            baseHeight: baseHeight,
            height: height,
            totalHeight: baseHeight + height,
            floorHeight: floorHeight
        };
        return buildingGroup;
    } catch (error) {
        console.error(`创建带楼层分割线的楼栋主体失败 (${name}):`, error);
        return null;
    }
}

// 创建顶部户型多边形
function createUnitPolygons(units, buildingHeight, buildingName) {
    const polygons = [];
    
    try {
        units.forEach((unit, index) => {
            if (unit.polygon && unit.polygon.length > 0) {
                const unitPolygon = createSingleUnitPolygon(unit, buildingHeight, buildingName);
                if (unitPolygon) {
                    polygons.push(unitPolygon);
                }
            }
        });
        
        console.log(`楼栋 ${buildingName} 创建了 ${polygons.length} 个户型多边形`);
        
    } catch (error) {
        console.error(`创建户型多边形失败 (${buildingName}):`, error);
    }
    
    return polygons;
}

// 创建单个户型多边形
function createSingleUnitPolygon(unit, height, buildingName) {
    try {
        const points = unit.polygon.map(coord => {
            const worldPos = object3DLayer.convertLngLat(coord);
            return new THREE.Vector2(worldPos[0], worldPos[1]);
        });
        const shape = new THREE.Shape(points);
        const geometry = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshLambertMaterial({
            color: unit.color || '#ff9999',
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        const edges = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000,
            linewidth: 2,
            opacity: 0.8,
            transparent: true
        });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        const unitGroup = new THREE.Group();
        unitGroup.add(mesh);
        unitGroup.add(wireframe);
        // 只做Z轴平移
        unitGroup.position.set(0, 0, height + 0.01);
        unitGroup.rotation.x = 0;
        unitGroup.userData = {
            type: 'unitPolygon',
            unitName: unit.name,
            buildingName: buildingName,
            area: unit.area,
            orientation: unit.orientation,
            color: unit.color,
            height: height + 0.01
        };
        return unitGroup;
    } catch (error) {
        console.error(`创建户型多边形失败 (${unit.name}):`, error);
        return null;
    }
}

// Three.js图层加载完成后的回调
function onThreeLayerComplete() {
    console.log('Three.js图层加载完成，开始创建3D楼栋...');
    
    // 延迟创建3D楼栋，确保图层完全准备好
    setTimeout(() => {
        create3DBuildings();
    }, 500);
}

// 更新3D楼栋可见性（Three.js版本）
function update3DBuildingsVisibility() {
    // 降低缩放层级要求，让楼层分割线更容易看到
    const shouldShow = currentZoomLevel >= 18.4 && currentZoomLevel <= 20;
    // 在缩放层级19-20之间显示户型多边形
    const shouldShowUnits = currentZoomLevel >= 19 && currentZoomLevel <= 20;
    
    console.log(`当前缩放层级: ${currentZoomLevel}, 楼栋显示: ${shouldShow}, 户型显示: ${shouldShowUnits}`);
    
    let visibleCount = 0;
    buildingMeshes.forEach(buildingInfo => {
        const buildingGroup = buildingInfo.mesh;
        
        if (shouldShow && !buildingInfo.visible) {
            // 显示建筑群组
            buildingGroup.visible = true;
            buildingGroup.traverse((child) => {
                if (child.userData.type === 'unitPolygon') {
                    // 户型多边形根据更高的缩放要求显示
                    child.visible = shouldShowUnits;
                } else {
                    child.visible = true;
                }
            });
            
            buildingInfo.visible = true;
            visibleCount++;
            console.log(`显示楼栋: ${buildingInfo.building.name}`);
        } else if (!shouldShow && buildingInfo.visible) {
            // 隐藏建筑群组
            buildingGroup.visible = false;
            buildingGroup.traverse((child) => {
                child.visible = false;
            });
            
            buildingInfo.visible = false;
            console.log(`隐藏楼栋: ${buildingInfo.building.name}`);
        } else if (shouldShow && buildingInfo.visible) {
            // 更新户型多边形的可见性
            buildingGroup.traverse((child) => {
                if (child.userData.type === 'unitPolygon') {
                    child.visible = shouldShowUnits;
                }
            });
            
            visibleCount++;
        }
    });
    
    console.log(`当前可见楼栋数量: ${visibleCount}`);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 获取项目名称参数
    projectName = getUrlParameter('community');
    
    try {
        // 加载项目数据
        projectData = await loadProjectData(projectName);
        
        // 使用项目中心点初始化地图
        const center = (projectData && projectData.center && Array.isArray(projectData.center) && projectData.center.length === 2) 
            ? projectData.center 
            : [114.057868, 22.543099];
        
        initMap(center);
        
        // 更新页面标题
        if (projectData && projectData.name) {
            document.title = `3D新房可视化地图 - ${projectData.name}`;
        }
        
        // 等待地图加载完成后初始化3D功能
        map.on('complete', function() {
            currentZoomLevel = map.getZoom();
            init3DLabels();
            
            // 延迟初始化，确保地图完全加载
            setTimeout(() => {
                onThreeLayerComplete();
            }, 1000);
        });
        
    } catch (error) {
        console.error('初始化失败:', error.message);
        // 出错时使用默认中心点
        initMap([114.057868, 22.543099]);
    }
});

// 绘图功能初始化
document.addEventListener('DOMContentLoaded', function() {
    // 等待一小段时间确保地图已加载
    setTimeout(() => {
        initDrawingTools();
    }, 1000);
});

// 初始化绘图工具
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
            
            // 如果查看器显示，同时启用查看器绘制
            const viewer = document.getElementById('unit-image-viewer');
            if (viewer && viewer.classList.contains('show')) {
                const viewerCanvas = document.getElementById('viewer-draw-canvas');
                if (viewerCanvas) {
                    viewerCanvas.classList.add('drawing');
                }
            }
        } else {
            canvas.classList.remove('drawing');
            colorPanel.classList.add('hidden');
            startDrawBtn.textContent = '开启绘图';
            startDrawBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            isDrawing = false;
            
            // 如果查看器显示，同时禁用查看器绘制
            const viewer = document.getElementById('unit-image-viewer');
            if (viewer && viewer.classList.contains('show')) {
                const viewerCanvas = document.getElementById('viewer-draw-canvas');
                if (viewerCanvas) {
                    viewerCanvas.classList.remove('drawing');
                }
            }
        }
    });

    // 清除绘图
    clearDrawBtn.addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 如果查看器显示，同时清除查看器绘制内容
        const viewer = document.getElementById('unit-image-viewer');
        if (viewer && viewer.classList.contains('show')) {
            const viewerCanvas = document.getElementById('viewer-draw-canvas');
            if (viewerCanvas) {
                const viewerCtx = viewerCanvas.getContext('2d');
                viewerCtx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
            }
        }
    });

    // 颜色选择
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelector('.color-option.selected').classList.remove('selected');
            this.classList.add('selected');
            currentColor = this.dataset.color;
            ctx.strokeStyle = currentColor;
            
            // 如果查看器显示，同时更新查看器画笔颜色
            const viewer = document.getElementById('unit-image-viewer');
            if (viewer && viewer.classList.contains('show')) {
                const viewerCanvas = document.getElementById('viewer-draw-canvas');
                if (viewerCanvas) {
                    const viewerCtx = viewerCanvas.getContext('2d');
                    viewerCtx.strokeStyle = currentColor;
                }
            }
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

// ============= 3D标注系统 =============

// 初始化3D标注系统
function init3DLabels() {
    if (!projectData) {
        console.log('项目数据未加载，跳过3D标注初始化');
        return;
    }
    createSimple3DLabels();
}

// 创建户型标注
function createSimple3DLabels() {
    // 创建小区名称标注
    if (projectData.name && projectData.center) {
        const communityMarker = createCommunityMarker(projectData.center, projectData.name);
        communityMarker.setMap(map);
        if (!window.labelMarkers) window.labelMarkers = [];
        window.labelMarkers.push({
            marker: communityMarker,
            type: 'community',
            minZoom: 15,
            maxZoom: 18.4
        });
    }
    // 创建设施标注
    if (projectData.facilities) {
        Object.entries(projectData.facilities).forEach(([category, data]) => {
            data.items.forEach(facility => {
                const facilityMarker = createFacilityMarker(facility.location, facility.name, data.color);
                facilityMarker.setMap(map);
                if (!window.labelMarkers) window.labelMarkers = [];
                window.labelMarkers.push({
                    marker: facilityMarker,
                    type: 'facility',
                    category: category,
                    minZoom: 15,
                    maxZoom: 18.4
                });
            });
        });
    }
    // 创建小区信息标注
    if (projectData.points && projectData.points.length > 0) {
        projectData.points.forEach(point => {
            const pointMarker = createPointMarker(point.location, point.name);
            pointMarker.setMap(map);
            pointMarker.hide();
            if (!window.labelMarkers) window.labelMarkers = [];
            window.labelMarkers.push({
                marker: pointMarker,
                type: 'point',
                minZoom: 18.4,
                maxZoom: 20
            });
        });
    }
    // 创建户型标注（自定义HTML+CSS）
    if (projectData.buildings) {
        projectData.buildings.forEach(building => {
            if (building.units && Array.isArray(building.units)) {
                building.units.forEach(unit => {
                    if (unit.center && Array.isArray(unit.center) && unit.center.length === 2) {
                        const name = unit.name || '';
                        const area = unit.area || '';
                        const orientation = unit.orientation || '';
                        const color = unit.color || '#285FF5';
                        const images = unit.images || [];
                        const buildingName = building.name || '';
                        const marker = createUnitMarker(
                            [unit.center[0], unit.center[1], (building.height || 0)],
                            name, area, orientation, color, images, buildingName
                        );
                        marker.hide();
                        map.add(marker);
                        if (!window.labelMarkers) window.labelMarkers = [];
                        window.labelMarkers.push({
                            marker: marker,
                            type: 'unit',
                            minZoom: 19,
                            maxZoom: 20
                        });
                    }
                });
            }
            // 添加楼栋标注
            if (building.center && Array.isArray(building.center) && building.center.length === 2) {
                const marker = createBuildingMarker(
                    [building.center[0], building.center[1], (building.height || 0)],
                    building.name || '',
                    building.floorCount || '',
                    building.ladderHouseRatio || ''
                );
                marker.hide();
                map.add(marker);
                if (!window.labelMarkers) window.labelMarkers = [];
                window.labelMarkers.push({
                    marker: marker,
                    type: 'building',
                    minZoom: 18.4,
                    maxZoom: 20
                });
            }
        });
    }
}

// 创建小区名称标注marker
function createCommunityMarker(lngLat, name) {
    // 创建自定义HTML内容
    const content = `
        <div class="community-label-3d">
            <div class="label-line"></div>
            <div class="label-content">
                <div class="label-text">${name}</div>
            </div>
        </div>
    `;
    
    const marker = new AMap.Marker({
        position: lngLat,
        content: content,
        anchor: 'bottom-center',
        zIndex: 1000
    });
    
    return marker;
}

// 创建设施标注marker
function createFacilityMarker(lngLat, name, color) {
    // 创建自定义HTML内容
    const content = `
        <div class="facility-label-3d" style="--facility-color: ${color}">
            <div class="facility-line"></div>
            <div class="facility-content">
                <div class="facility-text">${name}</div>
            </div>
        </div>
    `;
    
    const marker = new AMap.Marker({
        position: lngLat,
        content: content,
        anchor: 'bottom-center',
        zIndex: 999
    });
    
    return marker;
}

// 创建小区信息标注marker
function createPointMarker(lngLat, name) {
    // 创建自定义HTML内容
    const content = `
        <div class="point-label-3d">
            <div class="point-line"></div>
            <div class="point-content">
                <div class="point-text">${name}</div>
            </div>
        </div>
    `;
    
    const marker = new AMap.Marker({
        position: lngLat,
        content: content,
        anchor: 'bottom-center',
        zIndex: 998
    });
    
    return marker;
}

// 创建户型标注marker（自定义HTML+CSS）
function createUnitMarker(lngLat, name, area, orientation, color, images, buildingName) {
    // 结构：竖直白线 + 两行文本，文本白色，背景为color，无底部圆圈
    const content = `
        <div class=\"unit-label-3d custom-unit-label-3d\" style=\"--unit-color: ${color};\" onclick=\"handleUnitClick('${name}', '${area}', '${orientation}', ${JSON.stringify(images).replace(/"/g, '&quot;')}, '${buildingName}')\">
            <div class=\"unit-line custom-unit-line\"></div>
            <div class=\"unit-content custom-unit-content\">
                <div class=\"custom-unit-name\">${name}</div>
                <div class=\"custom-unit-area\">${area}${area && orientation ? ' | ' : ''}${orientation}</div>
            </div>
        </div>
    `;
    return new AMap.Marker({
        position: lngLat,
        content: content,
        anchor: 'bottom-center',
        zIndex: 1200
    });
}

// 创建楼栋标注marker（自定义HTML+CSS）
function createBuildingMarker(lngLat, name, floorCount, ladderHouseRatio) {
    // 蓝色线条，蓝色背景，两行信息：name单独一行，第二行为楼层/梯户比
    const content = `
        <div class=\"building-label-3d custom-building-label-3d\">
            <div class=\"building-line custom-building-line\"></div>
            <div class=\"building-content custom-building-content\">
                <div class=\"custom-building-name\">${name}</div>
                <div class=\"custom-building-info\">${floorCount ? floorCount + '层' : ''}${floorCount && ladderHouseRatio ? ' | ' : ''}${ladderHouseRatio || ''}</div>
            </div>
        </div>
    `;
    return new AMap.Marker({
        position: lngLat,
        content: content,
        anchor: 'bottom-center',
        zIndex: 1100
    });
}

// 根据缩放层级更新标注可见性
function updateLabelsVisibility() {
    if (!window.labelMarkers) return;
    
    window.labelMarkers.forEach(labelInfo => {
        const isVisible = currentZoomLevel >= labelInfo.minZoom && currentZoomLevel <= labelInfo.maxZoom;
        if (isVisible) {
            labelInfo.marker.show();
        } else {
            labelInfo.marker.hide();
        }
    });
}

// 户型图查看器相关变量
let currentImageIndex = 0;
let currentImages = [];
let preloadedImages = [];

// 处理户型标注点击事件
function handleUnitClick(name, area, orientation, images, buildingName) {
    console.log('户型标注被点击:', { name, area, orientation, images, buildingName });
    
    if (!images || images.length === 0) {
        alert('该户型暂无户型图');
        return;
    }
    
    // 初始化查看器
    initImageViewer(name, area, orientation, images, buildingName);
}

// 初始化图片查看器
function initImageViewer(name, area, orientation, images, buildingName) {
    currentImages = images;
    currentImageIndex = 0;
    preloadedImages = [];
    
    // 更新标题信息 - 将所有信息合并在一行显示
    const titleInfo = `${buildingName} | ${name} | ${area}${area && orientation ? ' | ' : ''}${orientation}`;
    document.getElementById('viewer-unit-name').textContent = titleInfo;
    document.getElementById('viewer-unit-info').textContent = ''; // 清空第二行
    
    // 更新计数器
    document.getElementById('current-index').textContent = '1';
    document.getElementById('total-count').textContent = images.length.toString();
    
    // 预加载所有图片
    preloadImages(images);
    
    // 显示第一张图片
    showImage(0);
    
    // 显示查看器
    const viewer = document.getElementById('unit-image-viewer');
    viewer.classList.add('show');
    
    // 初始化查看器绘制功能
    initViewerDrawing();
    
    // 绑定事件
    bindViewerEvents();
    
    // 测试位置（开发调试用）
    setTimeout(testViewerPosition, 100);
}

// 预加载图片
function preloadImages(images) {
    preloadedImages = [];
    images.forEach((imagePath, index) => {
        const img = new Image();
        img.onload = () => {
            preloadedImages[index] = img;
            console.log(`图片 ${index + 1} 预加载完成:`, imagePath);
        };
        img.onerror = () => {
            console.error(`图片 ${index + 1} 预加载失败:`, imagePath);
        };
        img.src = `data/${encodeURIComponent(projectName)}/${imagePath}`;
    });
}

// 显示指定索引的图片
function showImage(index) {
    if (index < 0 || index >= currentImages.length) return;
    
    currentImageIndex = index;
    const imageElement = document.getElementById('viewer-current-image');
    const imagePath = `data/${encodeURIComponent(projectName)}/${currentImages[index]}`;
    
    // 更新图片源
    imageElement.src = imagePath;
    
    // 更新计数器
    document.getElementById('current-index').textContent = (index + 1).toString();
    
    // 更新导航按钮状态
    updateNavButtons();
    
    // 重新调整绘制canvas尺寸（当图片加载完成后）
    imageElement.onload = function() {
        if (window.viewerDrawing && window.viewerDrawing.resize) {
            window.viewerDrawing.resize();
        }
    };
}

// 更新导航按钮状态
function updateNavButtons() {
    const prevBtn = document.getElementById('prev-image');
    const nextBtn = document.getElementById('next-image');
    
    prevBtn.disabled = currentImageIndex === 0;
    nextBtn.disabled = currentImageIndex === currentImages.length - 1;
}

// 绑定查看器事件
function bindViewerEvents() {
    // 关闭按钮
    const closeBtn = document.getElementById('viewer-close');
    closeBtn.onclick = closeViewer;
    
    // 遮罩层点击关闭（避开画笔工具栏区域）
    const overlay = document.querySelector('.viewer-overlay');
    overlay.onclick = (e) => {
        // 检查点击位置是否在画笔工具栏区域
        const rect = e.target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 画笔工具栏位于右上角，大约120px x 120px的区域
        const toolbarWidth = 120;
        const toolbarHeight = 120;
        const isInToolbarArea = x > rect.width - toolbarWidth && y < toolbarHeight;
        
        // 如果点击在工具栏区域，不关闭查看器
        if (isInToolbarArea) {
            return;
        }
        
        closeViewer();
    };
    
    // 导航按钮
    const prevBtn = document.getElementById('prev-image');
    const nextBtn = document.getElementById('next-image');
    
    prevBtn.onclick = () => {
        if (currentImageIndex > 0) {
            showImage(currentImageIndex - 1);
        }
    };
    
    nextBtn.onclick = () => {
        if (currentImageIndex < currentImages.length - 1) {
            showImage(currentImageIndex + 1);
        }
    };
    
    // 键盘事件
    document.addEventListener('keydown', handleKeydown);
    
    // 图片点击事件（防止事件冒泡）
    const imageContainer = document.querySelector('.image-container');
    imageContainer.onclick = (e) => {
        e.stopPropagation();
    };
    
    // 容器点击事件（防止事件冒泡）
    const container = document.querySelector('.viewer-container');
    container.onclick = (e) => {
        e.stopPropagation();
    };
}

// 处理键盘事件
function handleKeydown(e) {
    if (!document.getElementById('unit-image-viewer').classList.contains('show')) return;
    
    switch (e.key) {
        case 'Escape':
            closeViewer();
            break;
        case 'ArrowLeft':
            if (currentImageIndex > 0) {
                showImage(currentImageIndex - 1);
            }
            break;
        case 'ArrowRight':
            if (currentImageIndex < currentImages.length - 1) {
                showImage(currentImageIndex + 1);
            }
            break;
    }
}

// 关闭查看器
function closeViewer() {
    const viewer = document.getElementById('unit-image-viewer');
    viewer.classList.remove('show');
    
    // 清理事件监听器
    document.removeEventListener('keydown', handleKeydown);
    
    // 清理图片
    document.getElementById('viewer-current-image').src = '';
    
    // 清理绘制canvas
    const viewerCanvas = document.getElementById('viewer-draw-canvas');
    if (viewerCanvas) {
        const ctx = viewerCanvas.getContext('2d');
        ctx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
        viewerCanvas.classList.remove('drawing');
    }
    
    // 清理全局绘制对象
    if (window.viewerDrawing) {
        delete window.viewerDrawing;
    }
    
    // 重置状态
    currentImages = [];
    currentImageIndex = 0;
    preloadedImages = [];
}

// 测试查看器位置（开发调试用）
function testViewerPosition() {
    const viewer = document.getElementById('unit-image-viewer');
    const container = document.querySelector('.viewer-container');
    const toolbar = document.getElementById('draw-toolbar');
    
    if (viewer && container && toolbar) {
        const containerRect = container.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        
        console.log('查看器位置:', {
            top: containerRect.top,
            left: containerRect.left,
            width: containerRect.width,
            height: containerRect.height
        });
        
        console.log('工具栏位置:', {
            top: toolbarRect.top,
            left: toolbarRect.left,
            width: toolbarRect.width,
            height: toolbarRect.height
        });
        
        // 检查是否重叠
        const isOverlapping = !(containerRect.right < toolbarRect.left || 
                               containerRect.left > toolbarRect.right || 
                               containerRect.bottom < toolbarRect.top || 
                               containerRect.top > toolbarRect.bottom);
        
        console.log('是否重叠:', isOverlapping);
    }
}

// 查看器绘制功能
function initViewerDrawing() {
    const viewerCanvas = document.getElementById('viewer-draw-canvas');
    const viewerImage = document.getElementById('viewer-current-image');
    const ctx = viewerCanvas.getContext('2d');
    
    let isViewerDrawing = false;
    let lastViewerX = 0;
    let lastViewerY = 0;
    
    // 获取当前画笔颜色
    function getCurrentColor() {
        const selectedColor = document.querySelector('.color-option.selected');
        return selectedColor ? selectedColor.dataset.color : '#285FF5';
    }
    
    // 设置canvas尺寸和样式
    function resizeViewerCanvas() {
        if (!viewerImage.complete) {
            // 图片未加载完成，等待加载
            viewerImage.onload = resizeViewerCanvas;
            return;
        }
        
        const imageRect = viewerImage.getBoundingClientRect();
        const containerRect = viewerCanvas.parentElement.getBoundingClientRect();
        
        // 计算图片在容器中的实际显示尺寸
        const imageAspectRatio = viewerImage.naturalWidth / viewerImage.naturalHeight;
        const containerAspectRatio = containerRect.width / containerRect.height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imageAspectRatio > containerAspectRatio) {
            // 图片更宽，以宽度为准
            drawWidth = containerRect.width;
            drawHeight = containerRect.width / imageAspectRatio;
            drawX = 0;
            drawY = (containerRect.height - drawHeight) / 2;
        } else {
            // 图片更高，以高度为准
            drawHeight = containerRect.height;
            drawWidth = containerRect.height * imageAspectRatio;
            drawX = (containerRect.width - drawWidth) / 2;
            drawY = 0;
        }
        
        // 设置canvas尺寸
        viewerCanvas.width = drawWidth;
        viewerCanvas.height = drawHeight;
        viewerCanvas.style.width = drawWidth + 'px';
        viewerCanvas.style.height = drawHeight + 'px';
        viewerCanvas.style.left = drawX + 'px';
        viewerCanvas.style.top = drawY + 'px';
        
        // 设置绘制样式
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = getCurrentColor();
    }
    
    // 初始化canvas
    resizeViewerCanvas();
    
    // 监听图片加载完成
    viewerImage.addEventListener('load', resizeViewerCanvas);
    
    // 监听窗口大小变化
    window.addEventListener('resize', resizeViewerCanvas);
    
    // 绘制事件处理
    function startViewerDraw(e) {
        isViewerDrawing = true;
        [lastViewerX, lastViewerY] = getViewerCoordinates(e);
    }
    
    function drawViewer(e) {
        if (!isViewerDrawing) return;
        
        const [currentX, currentY] = getViewerCoordinates(e);
        
        ctx.beginPath();
        ctx.moveTo(lastViewerX, lastViewerY);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        
        [lastViewerX, lastViewerY] = [currentX, currentY];
    }
    
    function stopViewerDraw() {
        isViewerDrawing = false;
    }
    
    function getViewerCoordinates(e) {
        const rect = viewerCanvas.getBoundingClientRect();
        return [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
    }
    
    // 绑定绘制事件
    viewerCanvas.addEventListener('mousedown', startViewerDraw);
    viewerCanvas.addEventListener('mousemove', drawViewer);
    viewerCanvas.addEventListener('mouseup', stopViewerDraw);
    viewerCanvas.addEventListener('mouseout', stopViewerDraw);
    
    // 触摸事件支持
    viewerCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        viewerCanvas.dispatchEvent(mouseEvent);
    });
    
    viewerCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        viewerCanvas.dispatchEvent(mouseEvent);
    });
    
    viewerCanvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const mouseEvent = new MouseEvent('mouseup');
        viewerCanvas.dispatchEvent(mouseEvent);
    });
    
    // 监听颜色变化
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', function() {
            ctx.strokeStyle = getCurrentColor();
        });
    });
    
    // 监听绘制开关状态
    const startDrawBtn = document.getElementById('start-draw');
    const originalClickHandler = startDrawBtn.onclick;
    
    startDrawBtn.addEventListener('click', function() {
        // 延迟执行，确保原始状态已更新
        setTimeout(() => {
            const isDrawingEnabled = startDrawBtn.textContent === '关闭绘图';
            if (isDrawingEnabled) {
                viewerCanvas.classList.add('drawing');
            } else {
                viewerCanvas.classList.remove('drawing');
            }
        }, 10);
    });
    
    // 清除查看器绘制内容
    function clearViewerDrawing() {
        ctx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
    }
    
    // 监听清除按钮
    const clearDrawBtn = document.getElementById('clear-draw');
    clearDrawBtn.addEventListener('click', clearViewerDrawing);
    
    // 保存绘制功能到全局变量，以便后续使用
    window.viewerDrawing = {
        canvas: viewerCanvas,
        ctx: ctx,
        clear: clearViewerDrawing,
        resize: resizeViewerCanvas
    };
    
    console.log('查看器绘制功能初始化完成');
}
