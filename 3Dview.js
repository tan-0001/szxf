// 全局变量
let map;
let projectData = null;
let projectName = '';
let schoolData = null;
let loupanData = null;

// Three.js相关变量
let scene, camera, renderer;
let labelGroup;
let customLayer;
let currentZoomLevel = 16;

// ========== 显示层级控制（zoom 越小越远，越大越近） ==========
// 3D 楼栋：zoom >= 此值时显示楼栋
const ZOOM_SHOW_BUILDINGS = 18;
// 楼栋上的户型多边形：zoom >= 此值时显示
const ZOOM_SHOW_UNITS = 18.5;
// points（正门、地库入口等）：zoom 在此区间内显示
const ZOOM_POINTS_MIN = 17;
const ZOOM_POINTS_MAX = 18;
// 楼栋名称标注：zoom 在此区间内显示
const ZOOM_BUILDING_LABEL_MIN = 18;
const ZOOM_BUILDING_LABEL_MAX = 20;
// 户型标注：zoom 在此区间内显示
const ZOOM_UNIT_LABEL_MIN = 18.5;
const ZOOM_UNIT_LABEL_MAX = 20;

// 全局3D楼栋mesh数组
let buildingMeshes = [];

// CSS2D渲染器用于HTML标注
let labelRenderer;
let renderDebounceTimer;

// 楼盘范围多边形 overlay（来自 loupan.json，与小区名称颜色一致）
let loupanPolygonOverlay = null;

// Three.js 3D 图层（户型高亮需用其坐标转换）
let object3DLayer = null;



// 获取URL参数
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// 判断点是否在多边形内（射线法），polygon 为 [ [lng,lat], ... ] 闭合环
function pointInPolygon(lngLat, polygon) {
    if (!polygon || polygon.length < 3) return false;
    const [x, y] = lngLat;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

// 两经纬度点距离（千米），Haversine
function distanceKm(lngLat1, lngLat2) {
    const R = 6371;
    const dLat = (lngLat2[1] - lngLat1[1]) * Math.PI / 180;
    const dLng = (lngLat2[0] - lngLat1[0]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lngLat1[1] * Math.PI / 180) * Math.cos(lngLat2[1] * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
        // 创建Three.js图层（开启抗锯齿，线条更清晰无锯齿）
        object3DLayer = new AMap.ThreeLayer(map, { antialias: true });
        
        object3DLayer.on('complete', function() {
            console.log('Three.js图层初始化完成');
            
            // 设置像素比，高DPI屏上更清晰
            const renderer = object3DLayer.getRender();
            if (renderer && renderer.setPixelRatio) {
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            }
            
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
        // 分割线：用 Line2 + LineMaterial 绘制抗锯齿的每层闭合线
        const floorLineColorNum = typeof floorLineColor === 'string'
            ? parseInt(String(floorLineColor).replace('#', ''), 16) : floorLineColor;
        const resolution = (() => {
            try {
                const container = object3DLayer.getMap().getContainer();
                return new THREE.Vector2(container.offsetWidth || 800, container.offsetHeight || 600);
            } catch (e) { return new THREE.Vector2(800, 600); }
        })();
        const floorCount = Math.floor(height / floorHeight) - 1;
        for (let i = 1; i <= floorCount; i++) {
            const z = baseHeight + i * floorHeight;
            const layerPoints = points.map(p => new THREE.Vector3(p.x, p.y, z));
            layerPoints.push(new THREE.Vector3(points[0].x, points[0].y, z)); // 闭合
            const positions = [];
            layerPoints.forEach(p => { positions.push(p.x, p.y, p.z); });
            const lineGeometry = new THREE.LineGeometry().setPositions(positions);
            const lineMaterial = new THREE.LineMaterial({
                color: floorLineColorNum,
                linewidth: 2.1,
                worldUnits: false,
                resolution: resolution
            });
            const line = new THREE.Line2(lineGeometry, lineMaterial);
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
        unitGroup.renderOrder = 1000;
        mesh.renderOrder = 1000;
        wireframe.renderOrder = 1001;
        // 只做Z轴平移
        unitGroup.position.set(0, 0, height + 0.01);
        unitGroup.rotation.x = 0;
        unitGroup.userData = {
            type: 'unitPolygon',
            unitName: unit.name,
            buildingName: buildingName,
            area: unit.area,
            orientation: unit.orientation,
            roomsBaths: unit.roomsBaths,
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

// 更新3D楼栋可见性（Three.js版本）- 由 ZOOM_SHOW_BUILDINGS / ZOOM_SHOW_UNITS 控制
function update3DBuildingsVisibility() {
    const shouldShow = currentZoomLevel >= ZOOM_SHOW_BUILDINGS && currentZoomLevel <= 20;
    const shouldShowUnits = currentZoomLevel >= ZOOM_SHOW_UNITS && currentZoomLevel <= 20;
    
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

// 加载学校与楼盘配套数据（供设施标注使用）
async function loadSchoolAndLoupanData() {
    try {
        const [schoolRes, loupanRes] = await Promise.all([
            fetch('school.json').then(r => r.ok ? r.json() : {}),
            fetch('loupan.json').then(r => r.ok ? r.json() : {})
        ]);
        schoolData = schoolRes.primarySchools || schoolRes.middleSchools ? schoolRes : null;
        loupanData = loupanRes.loupanList ? loupanRes : null;
    } catch (e) {
        console.warn('加载学校/楼盘数据失败:', e.message);
        schoolData = null;
        loupanData = null;
    }
}

// 根据小区中心从 school.json + loupan.json 组装设施数据：小学/中学分开（学区包含中心）、其余=loupan 周边 3km
// 类别键与筛选框 data-type 一致：primary=小学, middle=中学, subway=地铁, commerce=商业, park=公园, hospital=医院, municipal=政府
function getFacilitiesFromSchoolAndLoupan(center) {
    const facilities = {};
    const PRIMARY_COLOR = '#e02208';   // 小学-亮红
    const MIDDLE_COLOR = '#b71c1c';    // 中学-深红，与小学区分且不与楼盘蓝相近
    const COMMERCIAL_COLOR = '#ec25ad';
    const METRO_COLOR = '#12c6d1';
    const HOSPITAL_COLOR = '#FF6B6B';
    const PARK_COLOR = '#4CAF50';
    const MUNICIPAL_COLOR = '#4CAF50';
    const RADIUS_KM = 3;

    if (!center || center.length < 2) return facilities;

    // 小学、中学：从 school.json 分开，学区多边形包含 center 的显示，名称完整（如 灵芝小学、宝安中学）
    if (schoolData) {
        const addSchool = (s, key, color) => {
            const ring = s.district && s.district.polygon && s.district.polygon[0];
            if (ring && pointInPolygon(center, ring)) {
                const name = s.name || '';
                return { name, location: s.coordinates || [0, 0], color };
            }
            return null;
        };
        const primaryItems = (schoolData.primarySchools || []).map(s => addSchool(s, 'primary', PRIMARY_COLOR)).filter(Boolean);
        const middleItems = (schoolData.middleSchools || []).map(s => addSchool(s, 'middle', MIDDLE_COLOR)).filter(Boolean);
        if (primaryItems.length) facilities.primary = { color: PRIMARY_COLOR, items: primaryItems.map(({ name, location }) => ({ name, location })) };
        if (middleItems.length) facilities.middle = { color: MIDDLE_COLOR, items: middleItems.map(({ name, location }) => ({ name, location })) };
    }

    // 地铁、商业、医院、公园、政府：从 loupan.json 取 3km 内，键与筛选框一致
    if (loupanData) {
        const within3km = (item) => (item.coordinates && distanceKm(center, item.coordinates) <= RADIUS_KM);
        const toItem = (item) => ({ name: item.name, location: item.coordinates || [0, 0] });
        const lists = [
            [loupanData.subwayList, METRO_COLOR, 'subway'],
            [loupanData.commerceList, COMMERCIAL_COLOR, 'commerce'],
            [loupanData.hospitalList, HOSPITAL_COLOR, 'hospital'],
            [loupanData.parkList, PARK_COLOR, 'park'],
            [loupanData.municipalList, MUNICIPAL_COLOR, 'municipal']
        ];
        lists.forEach(([list, color, key]) => {
            if (!list || !Array.isArray(list)) return;
            const items = list.filter(within3km).map(toItem);
            if (items.length) facilities[key] = { color, items };
        });
    }
    return facilities;
}

// 根据 URL 参数 community 加载项目并初始化地图（由依赖就绪后调用，避免被无参 initMap 覆盖）
async function start3DView() {
    projectName = getUrlParameter('community');
    
    try {
        await loadSchoolAndLoupanData();
        if (projectName) {
            projectData = await loadProjectData(projectName);
        }
        const center = (projectData && projectData.center && Array.isArray(projectData.center) && projectData.center.length === 2)
            ? projectData.center
            : [114.057868, 22.543099];
        
        initMap(center);
        
        if (projectData && projectData.name) {
            document.title = `3D新房可视化地图 - ${projectData.name}`;
        }
        
        map.on('complete', function() {
            currentZoomLevel = map.getZoom();
            init3DLabels();
            setTimeout(() => {
                onThreeLayerComplete();
            }, 1000);
        });
    } catch (error) {
        console.error('初始化失败:', error.message);
        initMap([114.057868, 22.543099]);
    }
}

// 绘图功能初始化
document.addEventListener('DOMContentLoaded', function() {
    initUnitFilterPanel();
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
    initFilterPanel();
    updateLabelsVisibility();
}

// 初始化配套筛选框（与 loupan 一致，默认显示小学、中学、地铁、商业）
function initFilterPanel() {
    const panel = document.getElementById('filter-panel');
    if (!panel) return;
    panel.classList.add('visible');
    panel.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => updateLabelsVisibility());
    });
}

// 从 loupan.json 按楼盘名称获取范围多边形路径（district.polygon 第一环）
function getLoupanPolygonPath(loupanName) {
    if (!loupanData || !loupanData.loupanList || !loupanName) return null;
    const loupan = loupanData.loupanList.find(l => (l.name || '').trim() === (loupanName || '').trim());
    if (!loupan || !loupan.district || !loupan.district.polygon || !loupan.district.polygon[0]) return null;
    const ring = loupan.district.polygon[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring.map(p => [p[0], p[1]]);
}

// 绘制楼盘范围多边形（边框与小区名称颜色一致 #285FF5，内部填充极低不透明度）
function addLoupanDistrictPolygon() {
    if (!map || !projectData || !projectData.name) return;
    const path = getLoupanPolygonPath(projectData.name);
    if (!path) return;
    if (loupanPolygonOverlay) {
        loupanPolygonOverlay.setMap(null);
        loupanPolygonOverlay = null;
    }
    const COMMUNITY_COLOR = '#285FF5'; // 与小区名称标注一致
    loupanPolygonOverlay = new AMap.Polygon({
        path: path,
        strokeColor: COMMUNITY_COLOR,
        strokeWeight: 1.5,
        strokeOpacity: 1,
        fillColor: COMMUNITY_COLOR,
        fillOpacity: 0.1,
        zIndex: 50
    });
    loupanPolygonOverlay.setMap(map);
}

// 创建户型标注
function createSimple3DLabels() {
    if (!projectData) return;
    // 楼盘范围多边形（来自 loupan.json，与小区名称颜色一致，填充极低不透明度）
    addLoupanDistrictPolygon();
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
    // 创建设施标注：学校来自 school.json（学区包含小区中心），其余来自 loupan.json 周边 3km
    if (projectData && projectData.center) {
        const facilities = getFacilitiesFromSchoolAndLoupan(projectData.center);
        if (facilities && Object.keys(facilities).length) {
            Object.entries(facilities).forEach(([category, data]) => {
                (data.items || []).forEach(facility => {
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
    }
    // 创建小区信息标注（正门、地库入口等）- 由 ZOOM_POINTS_MIN / ZOOM_POINTS_MAX 控制
    if (projectData.points && projectData.points.length > 0) {
        projectData.points.forEach(point => {
            const pointMarker = createPointMarker(point.location, point.name);
            pointMarker.setMap(map);
            pointMarker.hide();
            if (!window.labelMarkers) window.labelMarkers = [];
            window.labelMarkers.push({
                marker: pointMarker,
                type: 'point',
                minZoom: ZOOM_POINTS_MIN,
                maxZoom: ZOOM_POINTS_MAX
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
                        const roomsBaths = unit.roomsBaths || '';
                        const color = unit.color || '#285FF5';
                        const images = unit.images || [];
                        const buildingName = building.name || '';
                        const marker = createUnitMarker(
                            [unit.center[0], unit.center[1], (building.height || 0)],
                            name, area, orientation, roomsBaths, color, images, buildingName
                        );
                        marker.hide();
                        map.add(marker);
                        if (!window.labelMarkers) window.labelMarkers = [];
                        window.labelMarkers.push({
                            marker: marker,
                            type: 'unit',
                            unitKey: (buildingName || '') + '|' + (name || ''),
                            minZoom: ZOOM_UNIT_LABEL_MIN,
                            maxZoom: ZOOM_UNIT_LABEL_MAX
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
                    minZoom: ZOOM_BUILDING_LABEL_MIN,
                    maxZoom: ZOOM_BUILDING_LABEL_MAX
                });
            }
        });
    }
}

// 创建小区名称标注marker（使用 icon 文件夹中的楼盘图标图片）
function createCommunityMarker(lngLat, name) {
    const content = `
        <div class="community-label-3d">
            <img src="icon/loupan@3x.png" class="community-marker-icon" alt="">
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

// 创建户型标注marker（自定义HTML+CSS）；几房几卫不显示在标注上，仅传入户型图查看器下方信息框
function createUnitMarker(lngLat, name, area, orientation, roomsBaths, color, images, buildingName) {
    const line2 = [area, orientation].filter(Boolean).join(' | ');
    const roomsBathsEsc = (roomsBaths || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const unitKey = (buildingName || '') + '|' + (name || '');
    const unitKeyAttr = (unitKey || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const content = `
        <div class=\"unit-label-3d custom-unit-label-3d\" data-unit-key=\"${unitKeyAttr}\" style=\"--unit-color: ${color};\" onclick=\"handleUnitClick('${(name||'').replace(/'/g, "\\'")}', '${(area||'').replace(/'/g, "\\'")}', '${(orientation||'').replace(/'/g, "\\'")}', '${roomsBathsEsc}', ${JSON.stringify(images).replace(/"/g, '&quot;')}, '${(buildingName||'').replace(/'/g, "\\'")}')\">
            <div class=\"unit-line custom-unit-line\"></div>
            <div class=\"unit-content custom-unit-content\">
                <div class=\"custom-unit-name\">${name}</div>
                <div class=\"custom-unit-area\">${line2}</div>
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

// ========== 户型筛选：左侧面板、条件筛选、结果列表、3D 高亮 ==========
let unitFilterHighlighted = new Set(); // 当前高亮的户型 key 集合 "buildingName|unitName"
let unitHighlightMeshes = new Map();   // unitKey -> THREE.Group（户型从起始高度到楼顶的拉伸高亮体）
let unitFilterPrimary = null;          // 第一筛选项：'rooms' | 'area' | 'orientation'，谁先被选谁保留完整选项

function parseUnitRooms(roomsBaths) {
    if (!roomsBaths || typeof roomsBaths !== 'string') return null;
    const m = roomsBaths.match(/(\d+)\s*房/);
    return m ? parseInt(m[1], 10) : null;
}

function parseUnitAreaNum(areaStr) {
    if (!areaStr || typeof areaStr !== 'string') return null;
    const m = areaStr.match(/(\d+(?:\.\d+)?)\s*㎡?/);
    return m ? parseFloat(m[1]) : null;
}

function collectAllUnits() {
    const list = [];
    if (!projectData || !projectData.buildings) return list;
    projectData.buildings.forEach((building, bi) => {
        if (!building.units || !Array.isArray(building.units)) return;
        const buildingName = building.name || '';
        building.units.forEach((unit, ui) => {
            if (!unit.polygon || unit.polygon.length < 3) return;
            const orientation = (unit.orientation || '').trim();
            const rooms = parseUnitRooms(unit.roomsBaths);
            const areaNum = parseUnitAreaNum(unit.area);
            list.push({
                buildingIndex: bi,
                unitIndex: ui,
                buildingName,
                unit,
                orientation: orientation || null,
                rooms,
                areaNum,
                areaStr: unit.area || ''
            });
        });
    });
    return list;
}

function buildFilterOptions(units) {
    const orientations = new Set();
    const roomsSet = new Set();
    const areaSet = new Set();
    units.forEach(u => {
        if (u.orientation) orientations.add(u.orientation);
        if (u.rooms != null) roomsSet.add(u.rooms);
        if (u.areaNum != null) areaSet.add(u.areaNum);
    });
    return {
        orientations: Array.from(orientations).sort(),
        rooms: Array.from(roomsSet).sort((a, b) => a - b),
        areas: Array.from(areaSet).sort((a, b) => a - b)
    };
}

function renderUnitFilterOptions(containerId, options, optionType, checkedValues) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const checkedSet = new Set(checkedValues != null ? (Array.isArray(checkedValues) ? checkedValues : [checkedValues]) : []);
    const labels = optionType === 'orientation' ? options : optionType === 'rooms' ? options.map(r => `${r}房`) : options.map(a => `${a}㎡`);
    const values = options;
    container.innerHTML = options.map((val, i) => {
        const id = `unit-filter-${optionType}-${i}`;
        const label = labels[i];
        const checked = checkedSet.has(val) ? ' checked' : '';
        return `<label for="${id}"><input type="checkbox" id="${id}" data-value="${val}"${checked}> ${label}</label>`;
    }).join('');
}

function getUnitFilterSelections() {
    const orientation = [];
    const rooms = [];
    const areas = [];
    document.querySelectorAll('#unit-filter-orientation input:checked').forEach(el => { orientation.push(el.getAttribute('data-value')); });
    document.querySelectorAll('#unit-filter-rooms input:checked').forEach(el => { rooms.push(parseInt(el.getAttribute('data-value'), 10)); });
    document.querySelectorAll('#unit-filter-area input:checked').forEach(el => { areas.push(parseFloat(el.getAttribute('data-value'))); });
    return { orientation, rooms, areas };
}

function applyUnitFilter(allUnits, selections) {
    const { orientation: selOri, rooms: selRooms, areas: selAreas } = selections;
    return allUnits.filter(u => {
        const okOri = selOri.length === 0 || (u.orientation && selOri.includes(u.orientation));
        const okRooms = selRooms.length === 0 || (u.rooms != null && selRooms.includes(u.rooms));
        const okArea = selAreas.length === 0 || (u.areaNum != null && selAreas.includes(u.areaNum));
        return okOri && okRooms && okArea;
    });
}

function escapeUnitFilterHtml(s) {
    if (s == null || s === '') return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function sortUnitsForDisplay(units) {
    return units.slice().sort(function (a, b) {
        var bnA = (a.buildingName || '').trim();
        var bnB = (b.buildingName || '').trim();
        var cmpBuilding = bnA.localeCompare(bnB, 'zh-CN', { numeric: true });
        if (cmpBuilding !== 0) return cmpBuilding;
        var unA = (a.unit.name || '').trim();
        var unB = (b.unit.name || '').trim();
        return unA.localeCompare(unB, 'zh-CN', { numeric: true });
    });
}

function renderUnitFilterResultList(filteredUnits) {
    const listEl = document.getElementById('unit-filter-result-list');
    if (!listEl) return;
    var sorted = sortUnitsForDisplay(filteredUnits);
    listEl.innerHTML = sorted.map(u => {
        const key = `${u.buildingName}|${u.unit.name}`;
        const checked = unitFilterHighlighted.has(key) ? ' checked' : '';
        var title = escapeUnitFilterHtml(u.buildingName || '') + ' · ' + escapeUnitFilterHtml(u.unit.name || '');
        var areaSpan = u.areaStr ? '<span class="unit-result-pill unit-result-area">' + escapeUnitFilterHtml(u.areaStr) + '</span>' : '';
        var orientSpan = u.orientation ? '<span class="unit-result-pill unit-result-orient">' + escapeUnitFilterHtml(u.orientation) + '</span>' : '';
        var roomsSpan = u.unit.roomsBaths ? '<span class="unit-result-pill unit-result-rooms">' + escapeUnitFilterHtml(u.unit.roomsBaths) + '</span>' : '';
        var pills = [areaSpan, orientSpan, roomsSpan].filter(Boolean).join('');
        const keyAttr = escapeUnitFilterHtml(key).replace(/"/g, '&quot;');
        return `<div class="unit-filter-result-item" data-key="${keyAttr}">
            <input type="checkbox" data-key="${keyAttr}"${checked}>
            <div class="unit-filter-result-item-info">
                <div class="unit-result-title">${title}</div>
                ${pills ? '<div class="unit-result-pills">' + pills + '</div>' : ''}
            </div>
        </div>`;
    }).join('');
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', function() {
            const key = this.getAttribute('data-key');
            if (this.checked) {
                unitFilterHighlighted.add(key);
                setUnitHighlightIn3D(key, true);
            } else {
                unitFilterHighlighted.delete(key);
                setUnitHighlightIn3D(key, false);
            }
            const item = this.closest('.unit-filter-result-item');
            if (item) item.classList.toggle('highlight-on-map', this.checked);
            syncUnitLabelsHighlight();
            if (this.checked) centerMapOnSelectedUnits(key);
        });
    });
}

function syncUnitLabelsHighlight() {
    var elements = document.querySelectorAll('.custom-unit-label-3d[data-unit-key]');
    elements.forEach(function (el) {
        var key = el.getAttribute('data-unit-key');
        if (!key) return;
        if (unitFilterHighlighted.has(key)) {
            el.classList.add('unit-label-3d-highlight');
        } else {
            el.classList.remove('unit-label-3d-highlight');
        }
    });
}

function centerMapOnSelectedUnits(justSelectedKey) {
    if (!map || !projectData || !projectData.buildings) return;
    if (!justSelectedKey) return;
    var sep = justSelectedKey.indexOf('|');
    var bName = sep >= 0 ? justSelectedKey.substring(0, sep).trim() : justSelectedKey.trim();
    var uName = sep >= 0 ? justSelectedKey.substring(sep + 1).trim() : '';
    var center = null;
    for (var i = 0; i < projectData.buildings.length; i++) {
        var b = projectData.buildings[i];
        if ((b.name || '').trim() !== bName) continue;
        var units = b.units || [];
        for (var j = 0; j < units.length; j++) {
            if ((units[j].name || '').trim() !== uName) continue;
            var u = units[j];
            if (u.center && Array.isArray(u.center) && u.center.length >= 2) {
                center = [u.center[0], u.center[1]];
            } else if (b.center && Array.isArray(b.center) && b.center.length >= 2) {
                center = [b.center[0], b.center[1]];
            }
            break;
        }
        break;
    }
    if (!center) return;
    var duration = 500;
    map.setCenter(center, false, duration);
    map.setZoom(18.9, false, duration);
}

function polygonOutset2D(pts, distance) {
    if (!pts || pts.length < 3 || distance <= 0) return pts;
    var n = pts.length;
    var area = 0;
    for (var k = 0; k < n; k++) {
        var a = pts[k], b = pts[(k + 1) % n];
        area += a.x * b.y - b.x * a.y;
    }
    var outward = area > 0 ? 1 : -1;
    var out = [];
    for (var i = 0; i < n; i++) {
        var prev = pts[(i - 1 + n) % n];
        var curr = pts[i];
        var next = pts[(i + 1) % n];
        var ex1 = curr.x - prev.x, ey1 = curr.y - prev.y;
        var ex2 = next.x - curr.x, ey2 = next.y - curr.y;
        var len1 = Math.sqrt(ex1 * ex1 + ey1 * ey1) || 1e-6;
        var len2 = Math.sqrt(ex2 * ex2 + ey2 * ey2) || 1e-6;
        var n1x = outward * (ey1 / len1), n1y = outward * (-ex1 / len1);
        var n2x = outward * (ey2 / len2), n2y = outward * (-ex2 / len2);
        var bx = n1x + n2x, by = n1y + n2y;
        var bl = Math.sqrt(bx * bx + by * by) || 1e-6;
        var dot = n1x * n2x + n1y * n2y;
        dot = Math.max(-1, Math.min(1, dot));
        var halfAngle = Math.acos(dot) * 0.5;
        var sinHalf = Math.sin(halfAngle);
        var shift = sinHalf > 0.01 ? distance / sinHalf : distance;
        out.push(new THREE.Vector2(
            curr.x + (bx / bl) * shift,
            curr.y + (by / bl) * shift
        ));
    }
    return out;
}

function setUnitHighlightIn3D(unitKey, highlight) {
    const parts = unitKey.split('|');
    const bName = (parts[0] || '').trim();
    const uName = (parts.slice(1).join('|') || '').trim();

    if (!highlight) {
        const existing = unitHighlightMeshes.get(unitKey);
        if (existing) {
            if (existing.parent) existing.parent.remove(existing);
            existing.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                    else obj.material.dispose();
                }
            });
            unitHighlightMeshes.delete(unitKey);
            if (object3DLayer && typeof object3DLayer.update === 'function') object3DLayer.update();
            if (map && typeof map.render === 'function') map.render();
        }
        return;
    }

    if (unitHighlightMeshes.has(unitKey)) return;

    if (!projectData || !projectData.buildings || !object3DLayer) return;
    let building = null;
    let unit = null;
    let buildingGroup = null;
    for (let i = 0; i < projectData.buildings.length; i++) {
        const b = projectData.buildings[i];
        if ((b.name || '').trim() !== bName) continue;
        const units = b.units || [];
        for (let j = 0; j < units.length; j++) {
            if ((units[j].name || '').trim() === uName && units[j].polygon && units[j].polygon.length >= 3) {
                building = b;
                unit = units[j];
                break;
            }
        }
        if (building && unit) {
            const info = buildingMeshes.find(bi => (bi.building && (bi.building.name || '').trim()) === bName);
            if (info) buildingGroup = info.mesh;
            break;
        }
    }
    if (!building || !unit || !buildingGroup) {
        return;
    }

    const baseHeight = building.baseHeight != null ? building.baseHeight : 0;
    const totalHeight = building.height != null ? building.height : 30;
    const modelingHeight = Math.max(0, totalHeight - baseHeight);
    if (modelingHeight <= 0) return;

    try {
        var raw = unit.polygon.map(coord => {
            const worldPos = object3DLayer.convertLngLat(coord);
            return new THREE.Vector2(worldPos[0], worldPos[1]);
        });
        var n = raw.length;
        if (n < 3) return;
        var points = polygonOutset2D(raw, 0.05);
        if (!points || points.length < 3) points = raw;
        var positions = [];
        var indices = [];
        var depth = modelingHeight;
        for (var i = 0; i < points.length; i++) {
            var j = (i + 1) % points.length;
            var x0 = points[i].x, y0 = points[i].y;
            var x1 = points[j].x, y1 = points[j].y;
            positions.push(x0, y0, 0, x1, y1, 0, x1, y1, depth, x0, y0, depth);
            var base = (i * 4);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const highlightColor = 0xeb5757;
        var sideMaterial = new THREE.MeshLambertMaterial({
            color: highlightColor,
            transparent: true,
            opacity: 0.72,
            side: THREE.DoubleSide,
            emissive: highlightColor,
            emissiveIntensity: 0.85,
            depthTest: true,
            depthWrite: true
        });
        var mesh = new THREE.Mesh(geometry, sideMaterial);
        mesh.position.set(0, 0, baseHeight);
        mesh.renderOrder = 0;
        const highlightGroup = new THREE.Group();
        highlightGroup.renderOrder = 0;
        highlightGroup.add(mesh);
        highlightGroup.userData = { type: 'unitHighlight', unitKey };
        buildingGroup.add(highlightGroup);
        unitHighlightMeshes.set(unitKey, highlightGroup);
        if (object3DLayer && typeof object3DLayer.update === 'function') object3DLayer.update();
        if (map && typeof map.render === 'function') map.render();
    } catch (e) {
        console.warn('户型高亮体创建失败:', unitKey, e);
    }
}

function refreshUnitFilterCascade() {
    const allUnits = collectAllUnits();
    if (allUnits.length === 0) return;
    const selections = getUnitFilterSelections();
    var hasAny = selections.rooms.length > 0 || selections.areas.length > 0 || selections.orientation.length > 0;
    if (!hasAny) {
        unitFilterPrimary = null;
    } else {
        if (!unitFilterPrimary) {
            if (selections.rooms.length > 0) unitFilterPrimary = 'rooms';
            else if (selections.areas.length > 0) unitFilterPrimary = 'area';
            else unitFilterPrimary = 'orientation';
        } else {
            var primaryHasSelection = (unitFilterPrimary === 'rooms' && selections.rooms.length > 0) ||
                (unitFilterPrimary === 'area' && selections.areas.length > 0) ||
                (unitFilterPrimary === 'orientation' && selections.orientation.length > 0);
            if (!primaryHasSelection) unitFilterPrimary = null;
        }
    }
    var subset = applyUnitFilter(allUnits, selections);
    var optsAll = buildFilterOptions(allUnits);
    var optsSubset = buildFilterOptions(subset);
    var optsRooms = unitFilterPrimary === 'rooms' ? optsAll.rooms : optsSubset.rooms;
    var optsArea = unitFilterPrimary === 'area' ? optsAll.areas : optsSubset.areas;
    var optsOri = unitFilterPrimary === 'orientation' ? optsAll.orientations : optsSubset.orientations;
    renderUnitFilterOptions('unit-filter-rooms', optsRooms, 'rooms', selections.rooms);
    renderUnitFilterOptions('unit-filter-area', optsArea, 'area', selections.areas);
    renderUnitFilterOptions('unit-filter-orientation', optsOri, 'orientation', selections.orientation);
    var filtered = subset;
    renderUnitFilterResultList(filtered);
    syncUnitLabelsHighlight();
    document.querySelectorAll('#unit-filter-orientation input, #unit-filter-rooms input, #unit-filter-area input').forEach(function (el) {
        el.removeEventListener('change', onUnitFilterChange);
        el.addEventListener('change', onUnitFilterChange);
    });
}

function openUnitFilterPanel() {
    const panel = document.getElementById('unit-filter-panel');
    if (!panel) return;
    const allUnits = collectAllUnits();
    if (allUnits.length === 0) {
        document.getElementById('unit-filter-orientation').innerHTML = '<span class="unit-filter-empty">当前小区暂无户型数据</span>';
        document.getElementById('unit-filter-rooms').innerHTML = '';
        document.getElementById('unit-filter-area').innerHTML = '';
        document.getElementById('unit-filter-result-list').innerHTML = '';
        panel.classList.add('open');
        return;
    }
    refreshUnitFilterCascade();
    panel.classList.add('open');
}

function onUnitFilterChange() {
    refreshUnitFilterCascade();
}

function clearUnitFilterSelections() {
    var keys = Array.from(unitFilterHighlighted);
    keys.forEach(function (k) { setUnitHighlightIn3D(k, false); });
    unitFilterHighlighted.clear();
    var listEl = document.getElementById('unit-filter-result-list');
    if (listEl) {
        listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
        listEl.querySelectorAll('.unit-filter-result-item').forEach(function (item) { item.classList.remove('highlight-on-map'); });
    }
    syncUnitLabelsHighlight();
    if (object3DLayer && typeof object3DLayer.update === 'function') object3DLayer.update();
    if (map && typeof map.render === 'function') map.render();
}

function resetUnitFilterAll() {
    var roomsEl = document.getElementById('unit-filter-rooms');
    var areaEl = document.getElementById('unit-filter-area');
    var oriEl = document.getElementById('unit-filter-orientation');
    if (roomsEl) roomsEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
    if (areaEl) areaEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
    if (oriEl) oriEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
    unitFilterPrimary = null;
    clearUnitFilterSelections();
    refreshUnitFilterCascade();
}

function initUnitFilterPanel() {
    const trigger = document.getElementById('unit-filter-trigger');
    const panel = document.getElementById('unit-filter-panel');
    const closeBtn = document.getElementById('unit-filter-close');
    const resultResetBtn = document.getElementById('unit-filter-result-reset');
    const fullResetBtn = document.getElementById('unit-filter-full-reset');
    if (trigger) trigger.addEventListener('click', openUnitFilterPanel);
    if (closeBtn) closeBtn.addEventListener('click', () => { if (panel) panel.classList.remove('open'); });
    if (resultResetBtn) resultResetBtn.addEventListener('click', clearUnitFilterSelections);
    if (fullResetBtn) fullResetBtn.addEventListener('click', resetUnitFilterAll);
}

// 获取配套筛选框勾选状态（与 loupan 一致：primary/middle/subway/commerce/park/hospital/municipal）
function getFacilityFilterState() {
    const panel = document.getElementById('filter-panel');
    if (!panel) return {};
    const state = {};
    panel.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
        const type = cb.getAttribute('data-type');
        if (type) state[type] = cb.checked;
    });
    return state;
}

// 根据缩放层级与配套筛选框更新标注可见性
function updateLabelsVisibility() {
    if (!window.labelMarkers) return;
    const filterState = getFacilityFilterState();

    window.labelMarkers.forEach(labelInfo => {
        let isVisible = currentZoomLevel >= labelInfo.minZoom && currentZoomLevel <= labelInfo.maxZoom;
        if (labelInfo.type === 'facility' && labelInfo.category != null) {
            const filterOn = filterState[labelInfo.category] !== false;
            isVisible = isVisible && filterOn;
        }
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
let viewerImageScale = 1; // 图片滚轮缩放，幅度小（约 0.06/步）
let viewerImageTranslate = { x: 0, y: 0 }; // 图片拖拽平移
let viewerImageRotation = 0; // 图片旋转角度（度）

// 处理户型标注点击事件（roomsBaths 仅用于户型图查看器下方信息框，不显示在地图标注上）
function handleUnitClick(name, area, orientation, roomsBaths, images, buildingName) {
    console.log('户型标注被点击:', { name, area, orientation, roomsBaths, images, buildingName });
    
    if (!images || images.length === 0) {
        alert('该户型暂无户型图');
        return;
    }
    
    initImageViewer(name, area, orientation, roomsBaths, images, buildingName);
}

// 初始化图片查看器；下方信息框显示：楼栋 | 户型名 | 面积 | 朝向 | 几房几卫
function initImageViewer(name, area, orientation, roomsBaths, images, buildingName) {
    currentImages = images;
    currentImageIndex = 0;
    preloadedImages = [];
    
    const parts = [buildingName, name, area, orientation, roomsBaths].filter(Boolean);
    const titleInfo = parts.join(' | ');
    document.getElementById('viewer-unit-name').textContent = titleInfo;
    
    // 更新计数器
    document.getElementById('current-index').textContent = '1';
    document.getElementById('total-count').textContent = images.length.toString();
    
    // 预加载所有图片
    preloadImages(images);
    
    // 显示第一张图片
    viewerImageScale = 1;
    viewerImageTranslate = { x: 0, y: 0 };
    viewerImageRotation = 0;
    applyViewerImageTransform();
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

// 应用户型图变换：平移 + 旋转 + 缩放（统一应用，绘图坐标据此换算）
function applyViewerImageTransform() {
    const wrap = document.getElementById('viewer-image-wrap');
    if (wrap) {
        const t = viewerImageTranslate;
        wrap.style.transform = `translate(${t.x}px, ${t.y}px) rotate(${viewerImageRotation}deg) scale(${viewerImageScale})`;
    }
}

// 显示指定索引的图片
function showImage(index) {
    if (index < 0 || index >= currentImages.length) return;
    
    currentImageIndex = index;
    viewerImageScale = 1;
    viewerImageTranslate = { x: 0, y: 0 };
    viewerImageRotation = 0;
    applyViewerImageTransform();
    
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
    
    // 向右旋转按钮
    const rotateBtn = document.getElementById('viewer-rotate-btn');
    if (rotateBtn) rotateBtn.onclick = () => {
        viewerImageRotation = (viewerImageRotation + 90) % 360;
        applyViewerImageTransform();
    };
    
    // 图片区域：点击不关闭、滚轮缩放、拖拽平移
    const imageArea = document.getElementById('viewer-image-area');
    if (imageArea) {
        imageArea.onclick = (e) => e.stopPropagation();
        // 滚轮缩放
        imageArea.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 0.06;
            const delta = e.deltaY > 0 ? -step : step;
            viewerImageScale = Math.min(3, Math.max(0.5, viewerImageScale + delta));
            applyViewerImageTransform();
        }, { passive: false });
        // 拖拽平移（非绘图模式且未点在按钮上时）
        let isPanning = false, lastPanX = 0, lastPanY = 0;
        imageArea.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const isDrawCanvas = e.target.id === 'viewer-draw-canvas' && e.target.classList.contains('drawing');
            const isButton = e.target.closest('.nav-btn, .viewer-close, .viewer-rotate-btn, .viewer-info-bar');
            if (isDrawCanvas || isButton) return;
            isPanning = true;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            viewerImageTranslate.x += e.clientX - lastPanX;
            viewerImageTranslate.y += e.clientY - lastPanY;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            applyViewerImageTransform();
        });
        document.addEventListener('mouseup', () => { isPanning = false; });
        imageArea.addEventListener('mouseleave', () => { isPanning = false; });
    }
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
    viewerImageScale = 1;
    viewerImageTranslate = { x: 0, y: 0 };
    viewerImageRotation = 0;
}

// 测试查看器位置（开发调试用）
function testViewerPosition() {
    const viewer = document.getElementById('unit-image-viewer');
    const infoBar = document.querySelector('.viewer-info-bar');
    const toolbar = document.getElementById('draw-toolbar');
    
    if (viewer && infoBar && toolbar) {
        const infoBarRect = infoBar.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        console.log('户型信息框位置:', infoBarRect);
        console.log('工具栏位置:', toolbarRect);
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
    
    // 将鼠标位置转换为 canvas 内部坐标（解决缩放/平移/旋转后绘图偏移，即时响应）
    function getViewerCoordinates(e) {
        const rect = viewerCanvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [0, 0];
        const canvasX = (e.clientX - rect.left) * (viewerCanvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (viewerCanvas.height / rect.height);
        return [canvasX, canvasY];
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
