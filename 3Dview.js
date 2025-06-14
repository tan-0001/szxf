// 全局变量
let map;
let projectData = null;
let projectName = '';

// Three.js相关变量
let scene, camera, renderer;
let labelGroup;
let customLayer;
let currentZoomLevel = 16;

// CSS2D渲染器用于HTML标注
let labelRenderer;
let renderDebounceTimer;

// 3D楼栋相关变量
let object3DLayer;
let buildingMeshes = [];

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
        pitchEnable: true,        // 启用俯仰角调节（3D模式关键配置）
        rotateEnable: true,       // 启用旋转（3D模式关键配置）
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
            
            // 初始化CSS2D渲染器
            initCSS2DRenderer();
            
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

// ================== 通用标签创建工厂 ==================
function createCSS2DLabel({
    className,
    html,
    position3D
}) {
    const labelDiv = document.createElement('div');
    labelDiv.className = className;
    labelDiv.style.transform = 'translate(-50%, -100%)'; // 底部中心锚点
    labelDiv.innerHTML = html;
    if (typeof THREE.CSS2DObject !== 'undefined') {
        const css2dLabel = new THREE.CSS2DObject(labelDiv);
        css2dLabel.position.set(...position3D);
        return css2dLabel;
    } else {
        console.warn('CSS2DObject未定义，标注将不显示HTML内容');
        return null;
    }
}

// ================== 优化后的标签系统 ==================
class LabelSystem {
    constructor(threeLayer, coordinateSystem) {
        this.threeLayer = threeLayer;
        this.coordinateSystem = coordinateSystem;
        this.labels = new Map();
        this.visibleLabels = new Set();
    }

    // 创建楼栋标签
    createBuildingLabel(building) {
        if (!building.center || !building.name) {
            console.warn('楼栋缺少中心点或名称，跳过标注创建');
            return null;
        }
        try {
            // 1. 获取楼栋中心点的3D世界坐标（z为楼顶高度）
            const position3D = this.coordinateSystem.convertLngLatToWorld(
                building.center,
                building.height || 30
            );
            // 2. 创建一根直线，起点为楼顶中心，终点为上方8米
            //    用于连接楼栋和标签，增强空间感
            const start = new THREE.Vector3(...position3D);
            const end = new THREE.Vector3(position3D[0], position3D[1], position3D[2] + 8);
            const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
            const material = new THREE.LineBasicMaterial({ color: 0x285FF5, linewidth: 2 });
            const line = new THREE.Line(geometry, material);
            this.threeLayer.add(line); // 将直线添加到three.js图层
            // 3. 在直线终点创建一个CSS2D标签，显示楼栋名称
            //    标签锚点为底部中心，样式简洁美观
            const labelDiv = document.createElement('div');
            labelDiv.className = 'building-label-3d-text';
            labelDiv.style.transform = 'translate(-50%, -100%)'; // 底部中心锚点
            labelDiv.style.background = 'rgba(40,95,245,0.9)';
            labelDiv.style.color = '#fff';
            labelDiv.style.padding = '2px 8px';
            labelDiv.style.borderRadius = '4px';
            labelDiv.style.fontSize = '13px';
            labelDiv.style.fontWeight = 'bold';
            labelDiv.style.whiteSpace = 'nowrap';
            labelDiv.innerText = building.name;
            const css2dLabel = new THREE.CSS2DObject(labelDiv);
            css2dLabel.position.set(position3D[0], position3D[1], position3D[2] + 8); // 锚定在直线终点
            // 4. 通过userData将直线对象与标签对象关联，便于后续同步控制可见性
            css2dLabel.userData = {
                type: 'buildingLabel',
                buildingName: building.name,
                position: [position3D[0], position3D[1], position3D[2] + 8],
                line: line // 关联直线对象
            };
            this.labels.set(building.name, css2dLabel); // 存储标签对象
            this.threeLayer.add(css2dLabel); // 添加标签到three.js图层
            return css2dLabel;
        } catch (error) {
            console.error(`创建楼栋标注失败 (${building.name}):`, error);
            return null;
        }
    }

    // 创建户型标签
    createUnitLabel(unit, buildingHeight, buildingName) {
        if (!unit.center || !unit.name) {
            console.warn(`户型缺少中心点或名称，跳过标注创建: ${unit.name}`);
            return null;
        }
        try {
            // 1. 获取户型中心点的3D世界坐标（z为楼顶高度+0.01米，避免z-fighting）
            const position3D = this.coordinateSystem.convertLngLatToWorld(
                unit.center,
                buildingHeight + 0.01
            );
            
            // 2. 创建一根直线，起点为户型中心，终点为上方6米
            const start = new THREE.Vector3(...position3D);
            const end = new THREE.Vector3(position3D[0], position3D[1], position3D[2] + 6);
            const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
            const material = new THREE.LineBasicMaterial({ 
                color: 0xFFFFFF,  // 修改为白色
                linewidth: 1.5 
            });
            const line = new THREE.Line(geometry, material);
            this.threeLayer.add(line);

            // 3. 创建户型标签的HTML内容
            const labelDiv = document.createElement('div');
            labelDiv.className = 'unit-label-3d-text';
            labelDiv.style.transform = 'translate(-50%, -100%)';
            labelDiv.style.background = `rgba(${this.hexToRgb(unit.color || '#007BFF')}, 0.9)`;
            labelDiv.style.color = '#fff';
            labelDiv.style.padding = '2px 8px';
            labelDiv.style.borderRadius = '4px';
            labelDiv.style.fontSize = '12px';
            labelDiv.style.fontWeight = 'bold';
            labelDiv.style.whiteSpace = 'nowrap';
            labelDiv.style.textAlign = 'center';
            labelDiv.style.cursor = 'pointer';
            labelDiv.style.pointerEvents = 'auto';  // 只为标签启用鼠标事件
            
            // 4. 设置标签内容
            labelDiv.innerHTML = `
                <div class="unit-name" style="text-align: center;">${unit.name}</div>
                <div class="unit-info" style="text-align: center;">
                    ${unit.area ? `${unit.area}m²` : ''}
                    ${unit.orientation ? ` | ${unit.orientation}` : ''}
                </div>
            `;

            // 添加点击事件
            labelDiv.addEventListener('click', (event) => {
                event.stopPropagation();
                if (unit.images && unit.images.length > 0) {
                    showUnitImages(unit.images, unit.name);
                }
            });

            // 5. 创建CSS2D对象
            const css2dLabel = new THREE.CSS2DObject(labelDiv);
            css2dLabel.position.set(position3D[0], position3D[1], position3D[2] + 6);

            // 6. 设置用户数据
            css2dLabel.userData = {
                type: 'unitLabel',
                unitName: unit.name,
                buildingName: buildingName,
                position: [position3D[0], position3D[1], position3D[2] + 6],
                line: line,
                unit: unit
            };

            // 7. 存储标签对象
            this.labels.set(`${buildingName}-${unit.name}`, css2dLabel);
            this.threeLayer.add(css2dLabel);

            return css2dLabel;
        } catch (error) {
            console.error(`创建户型标注失败 (${unit.name}):`, error);
            return null;
        }
    }

    // 辅助方法：将十六进制颜色转换为RGB
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 
            `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
            '0, 123, 255';
    }

    // 更新标签可见性
    updateLabelsVisibility(zoomLevel) {
        // 楼栋相关元素（3D楼栋、楼栋标签、连线）在18-21级显示
        const shouldShowBuildings = zoomLevel >= 18 && zoomLevel <= 20;
        // 户型相关元素（户型框、户型标签、连线）在19.5-21级显示
        const shouldShowUnits = zoomLevel >= 19.5 && zoomLevel <= 20;

        this.labels.forEach((label, key) => {
            const isUnitLabel = label.userData.type === 'unitLabel';
            // 根据标签类型决定是否显示
            const shouldBeVisible = isUnitLabel ? shouldShowUnits : shouldShowBuildings;

            // 控制标签可见性
            label.visible = shouldBeVisible;
            
            // 控制线条可见性
            if (label.userData.line) {
                label.userData.line.visible = shouldBeVisible;
            }

            if (shouldBeVisible) {
                this.visibleLabels.add(key);
            } else {
                this.visibleLabels.delete(key);
            }
        });
    }

    // 获取可见标签
    getVisibleLabels() {
        return Array.from(this.visibleLabels).map(key => this.labels.get(key));
    }
}

// 同步控制系统
class SyncSystem {
    constructor(map, labelSystem) {
        this.map = map;
        this.labelSystem = labelSystem;
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
            const zoomLevel = this.map.getZoom();
            this.labelSystem.updateLabelsVisibility(zoomLevel);
            this.renderCount++;
        } catch (error) {
            console.error('稳定化渲染出错:', error);
        }
    }
}

// 初始化系统
function initSystems() {
    const coordinateSystem = new CoordinateSystem(object3DLayer);
    const labelSystem = new LabelSystem(object3DLayer, coordinateSystem);
    const syncSystem = new SyncSystem(map, labelSystem);

    return {
        coordinateSystem,
        labelSystem,
        syncSystem
    };
}

// 修改create3DBuildings函数
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
    
    projectData.buildings.forEach((building, index) => {
        if (building.polygon && building.polygon.length > 0) {
            try {
                const buildingGroup = createBuildingMesh(building);
                if (buildingGroup) {
                    object3DLayer.add(buildingGroup);
                
                    const buildingLabel = systems.labelSystem.createBuildingLabel(building);
                
                    const unitLabels = [];
                    if (building.units && building.units.length > 0) {
                        building.units.forEach(unit => {
                            const unitLabel = systems.labelSystem.createUnitLabel(
                                unit,
                                building.height,
                                building.name
                            );
                            if (unitLabel) {
                                object3DLayer.add(unitLabel);
                                unitLabel.visible = false;
                                unitLabels.push(unitLabel);
                            }
                        });
                    }
                
                    buildingMeshes.push({
                        mesh: buildingGroup,
                        building: building,
                        buildingLabel: buildingLabel,
                        unitLabels: unitLabels,
                        visible: true
                    });
                
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                console.error(`创建楼栋 ${building.name} 时出错:`, error);
                errorCount++;
            }
        }
    });
    
    console.log(`3D楼栋创建完成: 成功 ${successCount} 个, 失败 ${errorCount} 个`);
    
    update3DBuildingsVisibility();
}

// 创建单个楼栋的3D模型（使用Three.js）
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
        
        // 1. 创建楼栋主体
        const mainBuilding = createBuildingBody(polygon, building.center, baseHeight, modelingHeight, facadeColor, building.name);
        if (mainBuilding) {
            buildingGroup.add(mainBuilding);
        }
        
        // 2. 创建楼层线条
        const floorLines = createFloorLines(polygon, building.center, baseHeight, totalHeight, floorHeight, floorLineColor, building.name);
        floorLines.forEach(line => {
            if (line) buildingGroup.add(line);
        });
        
        // 3. 创建顶部户型多边形
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

// 创建楼栋主体（使用Three.js）
function createBuildingBody(polygon, center, baseHeight, height, color, name) {
    try {
        // 将经纬度多边形转换为Three.js坐标
        const points = polygon.map(coord => {
            const worldPos = object3DLayer.convertLngLat(coord);
            return new THREE.Vector2(worldPos[0], worldPos[1]);
        });
        
        // 创建形状
        const shape = new THREE.Shape(points);
        
        // 创建挤出几何体
        const extrudeSettings = {
            depth: height,
            bevelEnabled: false
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        
        // 创建材质
        const material = new THREE.MeshLambertMaterial({
            color: color,
            transparent: true,
            opacity: 0.95
        });
        
        // 创建网格
        const mesh = new THREE.Mesh(geometry, material);
        
        // 设置位置（重要：设置Z坐标为起始高度）
        const centerWorldPos = object3DLayer.convertLngLat(center);
        mesh.position.set(centerWorldPos[0], centerWorldPos[1], baseHeight);
        
        // 调整几何体使其以中心点为原点
        geometry.translate(-centerWorldPos[0], -centerWorldPos[1], 0);
        
        // 设置用户数据
        mesh.userData = {
            type: 'building',
            name: name,
            baseHeight: baseHeight,
            height: height,
            totalHeight: baseHeight + height
        };
        
        console.log(`楼栋主体创建完成: ${name}, 位置Z=${baseHeight}米, 高度=${height}米`);
        return mesh;
        
    } catch (error) {
        console.error(`创建楼栋主体失败 (${name}):`, error);
        return null;
    }
}

// 创建楼层线条
function createFloorLines(polygon, center, baseHeight, totalHeight, floorHeight, color, buildingName) {
    const lines = [];
    
    try {
        // 计算实际建筑高度和楼层数
        const modelingHeight = totalHeight - baseHeight;
        const actualFloors = Math.floor(modelingHeight / floorHeight);
        
        console.log(`楼栋 ${buildingName} 楼层线条计算:`, {
            totalHeight: totalHeight,
            baseHeight: baseHeight,
            modelingHeight: modelingHeight,
            floorHeight: floorHeight,
            actualFloors: actualFloors
        });
        
        // 从第1层开始创建楼层线条，确保不超出楼栋总高度
        for (let floor = 1; floor <= actualFloors; floor++) {
            const lineHeight = baseHeight + (floor * floorHeight);
            
            // 确保线条高度不超过楼栋总高度
            if (lineHeight <= totalHeight) {
                // 创建单层楼层线条
                const floorLine = createSingleFloorLine(polygon, lineHeight, color, buildingName, floor);
                if (floorLine) {
                    lines.push(floorLine);
                }
            } else {
                console.warn(`楼栋 ${buildingName} 第${floor}层线条高度${lineHeight}米超出总高度${totalHeight}米，跳过创建`);
                break;
            }
        }
        
        console.log(`楼栋 ${buildingName} 创建了 ${lines.length} 条楼层线条 (基于实际建筑高度${modelingHeight}米)`);
        
    } catch (error) {
        console.error(`创建楼层线条失败 (${buildingName}):`, error);
    }
    
    return lines;
}

// 创建单层楼层线条
function createSingleFloorLine(polygon, height, color, buildingName, floorNumber) {
    try {
        // 将经纬度多边形转换为Three.js世界坐标
        const worldPoints = polygon.map(coord => {
            const worldPos = object3DLayer.convertLngLat(coord);
            return new THREE.Vector3(worldPos[0], worldPos[1], height);
        });
        
        // 闭合多边形（添加第一个点到末尾）
        worldPoints.push(worldPoints[0].clone());
        
        // 创建线条几何体
        const geometry = new THREE.BufferGeometry().setFromPoints(worldPoints);
        
        // 创建线条材质
        const material = new THREE.LineBasicMaterial({
            color: color,
            opacity: 0.8,
            transparent: true,
            linewidth: 10
        });
        
        // 创建线条对象
        const line = new THREE.Line(geometry, material);
        
        // 设置用户数据
        line.userData = {
            type: 'floorLine',
            buildingName: buildingName,
            floorNumber: floorNumber,
            height: height
        };
        
        return line;
        
    } catch (error) {
        console.error(`创建楼层线条失败 (${buildingName} 第${floorNumber}层):`, error);
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
        console.log(`开始创建户型多边形: ${unit.name}, 楼栋: ${buildingName}, 高度: ${height}米`);
        console.log(`户型颜色: ${unit.color}, 户型多边形点数: ${unit.polygon.length}`);
        
        // 将经纬度多边形转换为Three.js坐标
        const points = unit.polygon.map(coord => {
            const worldPos = object3DLayer.convertLngLat(coord);
            return new THREE.Vector2(worldPos[0], worldPos[1]);
        });
        
        console.log(`户型 ${unit.name} 世界坐标转换完成，点数: ${points.length}`);
        
        // 创建形状
        const shape = new THREE.Shape(points);
        
        // 创建平面几何体，完全平面
        const geometry = new THREE.ShapeGeometry(shape);
        
        // 创建材质 - 使用更显眼的设置
        const material = new THREE.MeshLambertMaterial({
            color: unit.color || '#ff9999',
            transparent: true,
            opacity: 0.9, // 提高透明度
            side: THREE.DoubleSide
        });
        
        console.log(`户型 ${unit.name} 材质创建完成，颜色: ${unit.color}`);
        
        // 创建网格
        const mesh = new THREE.Mesh(geometry, material);
        
        // 创建边框线条
        const edges = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000, // 黑色边框
            linewidth: 2,
            opacity: 0.8,
            transparent: true
        });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        
        // 创建户型群组（包含填充和边框）
        const unitGroup = new THREE.Group();
        unitGroup.add(mesh);     // 添加填充
        unitGroup.add(wireframe); // 添加边框
        
        // 设置位置（贴合楼栋顶部）
        unitGroup.position.set(0, 0, height + 0.01); // 贴合楼栋顶部，微调避免Z-fighting
        
        // 让多边形水平放置
        unitGroup.rotation.x = 0; // 确保是水平的
        
        // 设置用户数据
        unitGroup.userData = {
            type: 'unitPolygon',
            unitName: unit.name,
            buildingName: buildingName,
            area: unit.area,
            orientation: unit.orientation,
            color: unit.color,
            height: height + 0.01
        };
        
        console.log(`户型多边形创建完成: ${unit.name}, 位置Z=${height + 0.01}米, 颜色=${unit.color}, 类型=平面`);
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
    // 在缩放层级17.5-20之间显示3D楼栋
    const shouldShow = currentZoomLevel >= 18 && currentZoomLevel <= 21;
    // 在缩放层级19-20之间显示户型多边形
    const shouldShowUnits = currentZoomLevel >= 19.5 && currentZoomLevel <= 21;
    
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
            
            // 显示楼栋标注
            if (buildingInfo.buildingLabel) {
                buildingInfo.buildingLabel.visible = true;
                console.log(`显示楼栋标注: ${buildingInfo.building.name}`);
            } else {
                console.warn(`楼栋标注不存在: ${buildingInfo.building.name}`);
            }
            
            // 根据户型显示要求控制户型标注
            if (buildingInfo.unitLabels && buildingInfo.unitLabels.length > 0) {
                buildingInfo.unitLabels.forEach(unitLabel => {
                    unitLabel.visible = shouldShowUnits;
                });
            }
            
            buildingInfo.visible = true;
            visibleCount++;
        } else if (!shouldShow && buildingInfo.visible) {
            // 隐藏建筑群组
            buildingGroup.visible = false;
            buildingGroup.traverse((child) => {
                child.visible = false;
            });
            
            // 隐藏楼栋标注
            if (buildingInfo.buildingLabel) {
                buildingInfo.buildingLabel.visible = false;
            }
            
            // 隐藏户型标注
            if (buildingInfo.unitLabels && buildingInfo.unitLabels.length > 0) {
                buildingInfo.unitLabels.forEach(unitLabel => {
                    unitLabel.visible = false;
                });
            }
            
            buildingInfo.visible = false;
        } else if (shouldShow && buildingInfo.visible) {
            // 更新户型多边形的可见性
            buildingGroup.traverse((child) => {
                if (child.userData.type === 'unitPolygon') {
                    child.visible = shouldShowUnits;
                }
            });
            
            // 更新户型标注的可见性
            if (buildingInfo.unitLabels && buildingInfo.unitLabels.length > 0) {
                buildingInfo.unitLabels.forEach(unitLabel => {
                    unitLabel.visible = shouldShowUnits;
                });
            }
            
            visibleCount++;
        }
    });
    
    console.log(`3D楼栋显示状态: ${shouldShow ? '显示' : '隐藏'}, 户型显示: ${shouldShowUnits ? '显示' : '隐藏'}, 缩放层级: ${currentZoomLevel}, 可见楼栋: ${visibleCount}/${buildingMeshes.length}`);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 获取项目名称参数
    projectName = getUrlParameter('community');
    
    if (!projectName) {
        // 使用默认中心点初始化地图
        initMap([114.057868, 22.543099]);
        return;
    }

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

// ============= 3D标注系统 =============

// 初始化3D标注系统
function init3DLabels() {
    if (!projectData) {
        console.log('项目数据未加载，跳过3D标注初始化');
        return;
    }
    
    console.log('开始初始化3D标注系统...');
    
    // 暂时使用简单的marker方式实现，后续再集成Three.js
    createSimple3DLabels();
}

// 创建简化的3D标注
function createSimple3DLabels() {
    console.log('创建简化的3D标注...');
    
    // 创建小区名称标注
    if (projectData.name && projectData.center) {
        const communityMarker = createCommunityMarker(projectData.center, projectData.name);
        communityMarker.setMap(map);
        
        // 存储标注，用于后续的显示控制
        if (!window.labelMarkers) window.labelMarkers = [];
        window.labelMarkers.push({
            marker: communityMarker,
            type: 'community',
            minZoom: 15,
            maxZoom: 18
        });
    }
    
    // 创建设施标注
    if (projectData.facilities && projectData.facilities.length > 0) {
        projectData.facilities.forEach(facility => {
            const facilityMarker = createFacilityMarker(facility.location, facility.name);
            facilityMarker.setMap(map);
            
            if (!window.labelMarkers) window.labelMarkers = [];
            window.labelMarkers.push({
                marker: facilityMarker,
                type: 'facility',
                minZoom: 15.1,
                maxZoom: 18
            });
        });
    }
    
    // 创建小区信息标注
    if (projectData.points && projectData.points.length > 0) {
        projectData.points.forEach(point => {
            const pointMarker = createPointMarker(point.location, point.name);
            pointMarker.setMap(map);
            // 初始状态设置为隐藏
            pointMarker.hide();
            
            if (!window.labelMarkers) window.labelMarkers = [];
            window.labelMarkers.push({
                marker: pointMarker,
                type: 'point',
                minZoom: 18,
                maxZoom: 20
            });
        });
    }
    
    // 初始化时更新标注可见性
    updateLabelsVisibility();
    
    console.log('3D标注创建完成');
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
function createFacilityMarker(lngLat, name) {
    // 创建自定义HTML内容
    const content = `
        <div class="facility-label-3d">
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
    
    console.log(`当前缩放层级: ${currentZoomLevel}, 标注数量: ${window.labelMarkers.length}`);
}

// ============= 楼栋和户型标注系统 =============

// 初始化CSS2D渲染器
function initCSS2DRenderer() {
    const checkCSS2D = () => {
        if (typeof THREE.CSS2DRenderer !== 'undefined') {
            try {
                labelRenderer = new THREE.CSS2DRenderer();
                labelRenderer.setSize(window.innerWidth, window.innerHeight);
                labelRenderer.domElement.style.position = 'absolute';
                labelRenderer.domElement.style.top = '0px';
                labelRenderer.domElement.style.left = '0px';
                labelRenderer.domElement.style.pointerEvents = 'none';  // 改回none
                labelRenderer.domElement.style.zIndex = '100';
                
                // 添加到页面
                document.body.appendChild(labelRenderer.domElement);
                
                console.log('CSS2D渲染器初始化完成');
                
                // 启动优化后的渲染循环
                startRenderLoop();
                
            } catch (error) {
                console.error('CSS2D渲染器初始化失败:', error);
            }
        } else {
            console.log('等待CSS2DRenderer加载...');
            setTimeout(checkCSS2D, 100);
        }
    };
    
    checkCSS2D();
}

// 优化渲染循环
function startRenderLoop() {
    if (!labelRenderer) {
        console.warn('CSS2D渲染器未初始化，无法启动渲染循环');
        return;
    }
    
    let lastRenderTime = 0;
    const renderInterval = 8.33; // 约60fps，提高渲染频率
    let animationFrameId;
    
    // 使用RAF优化渲染
    function animate(currentTime) {
        animationFrameId = requestAnimationFrame(animate);
        
        // 控制渲染频率
        if (currentTime - lastRenderTime < renderInterval) return;
        
        try {
            if (object3DLayer && object3DLayer.getCamera() && labelRenderer) {
                // 同步渲染所有元素
                const camera = object3DLayer.getCamera();
                labelRenderer.render(object3DLayer.getScene(), camera);
            }
        } catch (error) {
            console.error('CSS2D渲染过程中出错:', error);
        }
        
        lastRenderTime = currentTime;
    }
    
    // 优化地图事件处理
    if (map) {
        let isMoving = false;
        let moveEndTimeout;
        let forceUpdateCount = 0;
        
        map.on('movestart', () => {
            isMoving = true;
            if (moveEndTimeout) clearTimeout(moveEndTimeout);
        });
        
        map.on('moveend', () => {
            isMoving = false;
            // 地图停止后强制更新几帧
            forceUpdateCount = 0;
            const forceUpdate = () => {
                if (forceUpdateCount < 3) {  // 强制更新3帧
                    if (object3DLayer && object3DLayer.getCamera() && labelRenderer) {
                        labelRenderer.render(object3DLayer.getScene(), object3DLayer.getCamera());
                    }
                    forceUpdateCount++;
                    requestAnimationFrame(forceUpdate);
                }
            };
            requestAnimationFrame(forceUpdate);
        });
        
        // 优化缩放事件处理
        map.on('zoomstart', () => {
            isMoving = true;
        });
        
        map.on('zoomend', () => {
            isMoving = false;
            // 缩放结束后强制更新几帧
            forceUpdateCount = 0;
            const forceUpdate = () => {
                if (forceUpdateCount < 3) {  // 强制更新3帧
                    if (object3DLayer && object3DLayer.getCamera() && labelRenderer) {
                        labelRenderer.render(object3DLayer.getScene(), object3DLayer.getCamera());
                    }
                    forceUpdateCount++;
                    requestAnimationFrame(forceUpdate);
                }
            };
            requestAnimationFrame(forceUpdate);
        });
    }
    
    // 优化窗口大小变化处理
    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (labelRenderer) {
                labelRenderer.setSize(window.innerWidth, window.innerHeight);
                // 大小变化后立即渲染一帧
                if (object3DLayer && object3DLayer.getCamera()) {
                    labelRenderer.render(object3DLayer.getScene(), object3DLayer.getCamera());
                }
            }
        }, 100);
    });
    
    animate();
    console.log('优化后的CSS2D渲染循环已启动');
}

// 显示户型图片的函数
function showUnitImages(images, unitName) {
    // 创建图片查看器容器
    const viewer = document.createElement('div');
    viewer.className = 'unit-image-viewer';
    viewer.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: transparent;
        padding: 20px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        align-items: center;
    `;

    // 创建图片容器
    const imageContainer = document.createElement('div');
    imageContainer.style.cssText = `
        position: relative;
        width: 90vw;
        height: 80vh;
        margin-bottom: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
        background: transparent;
        overflow: hidden;
        cursor: move;
    `;

    // 创建图片元素
    const img = document.createElement('img');
    img.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        object-fit: contain;
        background: transparent;
        transform-origin: center center;
        transition: transform 0.1s ease-out;
    `;
    let currentIndex = 0;
    let scale = 1;
    let isDragging = false;
    let startX, startY;
    let translateX = 0;
    let translateY = 0;
    
    // 构建正确的图片路径
    const projectPath = `data/${encodeURIComponent(projectName)}/`;
    img.src = projectPath + images[currentIndex];
    
    // 添加图片加载错误处理
    img.onerror = () => {
        console.error(`图片加载失败: ${projectPath}${images[currentIndex]}`);
        img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjAwIDIwMCI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNlZWUiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE2IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+图片加载失败</dGV4dD48L3N2Zz4=';
    };

    // 添加鼠标滚轮缩放
    imageContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        scale = Math.min(Math.max(0.1, scale * delta), 10);
        updateTransform();
    });

    // 添加鼠标拖拽
    imageContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        imageContainer.style.cursor = 'grabbing';
    });

    imageContainer.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateTransform();
    });

    imageContainer.addEventListener('mouseup', () => {
        isDragging = false;
        imageContainer.style.cursor = 'move';
    });

    imageContainer.addEventListener('mouseleave', () => {
        isDragging = false;
        imageContainer.style.cursor = 'move';
    });

    // 更新变换
    function updateTransform() {
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }

    // 重置变换
    function resetTransform() {
        scale = 1;
        translateX = 0;
        translateY = 0;
        updateTransform();
    }
    
    imageContainer.appendChild(img);

    // 创建控制按钮容器
    const controls = document.createElement('div');
    controls.style.cssText = `
        display: flex;
        gap: 20px;
        align-items: center;
        background: rgba(0, 0, 0, 0.7);
        padding: 10px 20px;
        border-radius: 8px;
    `;

    // 上一张按钮
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '上一张';
    prevBtn.style.cssText = `
        padding: 8px 16px;
        background: #285FF5;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    prevBtn.onclick = () => {
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        img.src = projectPath + images[currentIndex];
        resetTransform();
    };

    // 下一张按钮
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下一张';
    nextBtn.style.cssText = `
        padding: 8px 16px;
        background: #285FF5;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    nextBtn.onclick = () => {
        currentIndex = (currentIndex + 1) % images.length;
        img.src = projectPath + images[currentIndex];
        resetTransform();
    };

    // 重置按钮
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '重置';
    resetBtn.style.cssText = `
        padding: 8px 16px;
        background: #285FF5;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    resetBtn.onclick = resetTransform;

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = `
        padding: 8px 16px;
        background: #ff4444;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    closeBtn.onclick = () => {
        document.body.removeChild(viewer);
    };

    // 添加标题
    const title = document.createElement('div');
    title.textContent = `${unitName}户型图`;
    title.style.cssText = `
        color: white;
        font-size: 18px;
        margin-bottom: 10px;
        background: rgba(0, 0, 0, 0.7);
        padding: 8px 16px;
        border-radius: 4px;
    `;

    // 组装查看器
    controls.appendChild(prevBtn);
    controls.appendChild(nextBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(closeBtn);
    viewer.appendChild(title);
    viewer.appendChild(imageContainer);
    viewer.appendChild(controls);

    // 添加到页面
    document.body.appendChild(viewer);
} 