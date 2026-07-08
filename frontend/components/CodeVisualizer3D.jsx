import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// 3D Code Visualizer Component
export default function CodeVisualizer3D({
  listKey,
  listVal = [],
  variables = {},
  prevVariables = {},
  scalarKeys = [],
  dictKeys = [],
  actionType = 'STEP',
  swapMessage = ''
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Keep track of mesh targets and animation properties in refs to bypass React render cycles
  const meshesRef = useRef({}); // keyed by element ID
  const elementIdsRef = useRef([]); // array of stable IDs corresponding to current indices
  const prevListValRef = useRef([]);

  // Coordinate projection state for HTML labels overlay
  const [labelCoords, setLabelCoords] = useState([]);
  
  // Scalar variables for stack visualization
  const [stackVars, setStackVars] = useState([]);

  // Heuristic stable ID tracking to make elements physically slide on swap
  useEffect(() => {
    if (!listVal || listVal.length === 0) {
      elementIdsRef.current = [];
      prevListValRef.current = [];
      return;
    }

    const prevListVal = prevListValRef.current;
    let newIds = [...elementIdsRef.current];

    if (newIds.length !== listVal.length) {
      // Reinitialize IDs
      newIds = listVal.map((_, i) => `el-${i}-${Math.random().toString(36).substr(2, 9)}`);
    } else {
      // Check if it's a swap of 2 elements
      const diffIndices = [];
      listVal.forEach((val, idx) => {
        if (prevListVal[idx] !== val) {
          diffIndices.push(idx);
        }
      });

      if (diffIndices.length === 2) {
        const [i1, i2] = diffIndices;
        if (listVal[i1] === prevListVal[i2] && listVal[i2] === prevListVal[i1]) {
          // Perform swap of stable IDs
          const temp = newIds[i1];
          newIds[i1] = newIds[i2];
          newIds[i2] = temp;
        }
      } else if (diffIndices.length > 2) {
        // Greedy matching for more complex reordering
        const usedOldIndices = new Set();
        const nextIds = new Array(listVal.length);
        
        // Step 1: Match unchanged elements
        listVal.forEach((val, idx) => {
          if (prevListVal[idx] === val) {
            nextIds[idx] = newIds[idx];
            usedOldIndices.add(idx);
          }
        });

        // Step 2: Match changed elements by value
        listVal.forEach((val, idx) => {
          if (nextIds[idx] === undefined) {
            let matchedIdx = -1;
            for (let j = 0; j < prevListVal.length; j++) {
              if (!usedOldIndices.has(j) && prevListVal[j] === val) {
                matchedIdx = j;
                break;
              }
            }
            if (matchedIdx !== -1) {
              nextIds[idx] = newIds[matchedIdx];
              usedOldIndices.add(matchedIdx);
            } else {
              // Create new ID if value is brand new
              nextIds[idx] = `el-${idx}-${Math.random().toString(36).substr(2, 9)}`;
            }
          }
        });
        newIds = nextIds;
      }
    }

    elementIdsRef.current = newIds;
    prevListValRef.current = [...listVal];
  }, [listVal]);

  // Handle scalar and dict variable changes for 3D Stack display
  useEffect(() => {
    const list = [];
    scalarKeys.forEach(key => {
      const val = variables[key];
      const prevVal = prevVariables[key];
      const isChanged = prevVal !== undefined && prevVal !== val;
      list.push({ key, val, isChanged, type: typeof val });
    });
    dictKeys.forEach(key => {
      const val = variables[key];
      const prevVal = prevVariables[key];
      const isChanged = prevVal !== undefined && JSON.stringify(prevVal) !== JSON.stringify(val);
      list.push({ key, val, isChanged, type: 'dict' });
    });
    setStackVars(list);
  }, [scalarKeys, dictKeys, variables, prevVariables]);

  // Main Three.js Runner
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    let width = container.clientWidth || 600;
    let height = container.clientHeight || 280;

    // 1. Setup Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffffff'); // White background as requested

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    // Position camera to look down at an angle (isometric feel)
    camera.position.set(0, 5, 9);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 2. Add Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(4, 8, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    // Subtle blue point light for premium accent
    const pointLight = new THREE.PointLight(0x6366f1, 0.4, 15);
    pointLight.position.set(0, 3, 2);
    scene.add(pointLight);

    // 3. Grid Helper (Subtle gray lines on white background)
    const gridHelper = new THREE.GridHelper(30, 30, 0xe2e8f0, 0xf1f5f9);
    gridHelper.position.y = -0.51;
    scene.add(gridHelper);

    // Group to hold all visualizer meshes (so we can rotate it for parallax)
    const visualizerGroup = new THREE.Group();
    scene.add(visualizerGroup);

    // 4. Mouse Move Parallax Logic
    let mouseX = 0;
    let mouseY = 0;
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mouseX = (x / rect.width) * 2 - 1;
      mouseY = -(y / rect.height) * 2 + 1;
    };
    container.addEventListener('mousemove', handleMouseMove);

    // 5. Materials
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f46e5, // Indigo
      roughness: 0.25,
      metalness: 0.1,
      flatShading: false
    });

    const compareMaterial = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Emerald green
      roughness: 0.15,
      metalness: 0.1,
      emissive: 0x10b981,
      emissiveIntensity: 0.15
    });

    const swapMaterial = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Coral Red
      roughness: 0.15,
      metalness: 0.1,
      emissive: 0xef4444,
      emissiveIntensity: 0.15
    });

    const changedMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Amber
      roughness: 0.2,
      metalness: 0.1,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.1
    });

    // Clean up outdated meshes from scene
    const activeMeshIds = new Set();
    
    // Animation tick
    let animationFrameId = null;

    const tick = () => {
      // Mouse Parallax lerping
      visualizerGroup.rotation.y += (mouseX * 0.15 - visualizerGroup.rotation.y) * 0.05;
      visualizerGroup.rotation.x += (-mouseY * 0.1 - visualizerGroup.rotation.x) * 0.05;

      const ids = elementIdsRef.current;
      const currentList = prevListValRef.current;

      // Determine heights sizing parameters (normalize heights of bars)
      const numericVals = currentList.map(v => typeof v === 'number' ? v : 1).filter(v => !isNaN(v));
      const maxVal = numericVals.length > 0 ? Math.max(...numericVals, 1) : 1;
      const minVal = numericVals.length > 0 ? Math.min(...numericVals, 0) : 0;
      
      const spacing = 1.0;
      const startX = -((currentList.length - 1) * spacing) / 2;

      // Extract pointers active indices
      const pointers = {};
      Object.entries(variables).forEach(([k, v]) => {
        if (typeof v === 'number' && v >= 0 && v < currentList.length && !k.startsWith('__') && k !== 'step_counter') {
          if (!pointers[v]) pointers[v] = [];
          pointers[v].push(k);
        }
      });

      // Synchronize and update 3D meshes
      activeMeshIds.clear();

      ids.forEach((id, index) => {
        const val = currentList[index];
        activeMeshIds.add(id);

        // Calculate heights
        let targetHeight = 1.5; // Default height for non-numbers
        if (typeof val === 'number') {
          const range = maxVal - minVal || 1;
          const pct = (val - minVal) / range;
          targetHeight = 0.4 + pct * 2.2; // Height between 0.4 and 2.6 units
        }

        // Calculate positions
        const targetX = startX + index * spacing;
        const targetY = targetHeight / 2 - 0.5; // Base is at y = -0.5
        const targetZ = 0;

        // Determine correct material color
        const activePointers = pointers[index] || [];
        const isPointed = activePointers.length > 0;
        const prevVal = prevVariables[listKey]?.[index];
        const wasChanged = prevVal !== undefined && prevVal !== val;

        let targetMat = baseMaterial;
        if (isPointed) {
          targetMat = actionType === 'SWAP' ? swapMaterial : compareMaterial;
        } else if (wasChanged) {
          targetMat = changedMaterial;
        }

        // Check if mesh already exists, otherwise create it
        let meshInfo = meshesRef.current[id];
        if (!meshInfo) {
          // Create rounded-like box geometry
          const geo = new THREE.BoxGeometry(0.65, 1, 0.65); // Height starts at 1, scale.y adjusts height
          const mesh = new THREE.Mesh(geo, baseMaterial.clone());
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          
          mesh.position.set(targetX, -10, targetZ); // Spawn from below
          visualizerGroup.add(mesh);

          meshInfo = {
            mesh,
            currentHeight: 0.1,
            targetHeight,
            targetX,
            targetY,
            targetZ,
            targetMat
          };
          meshesRef.current[id] = meshInfo;
        }

        // Update target properties
        meshInfo.targetX = targetX;
        meshInfo.targetHeight = targetHeight;
        meshInfo.targetY = targetY;
        meshInfo.targetMat = targetMat;

        // Smoothly interpolate (lerp) values
        const mesh = meshInfo.mesh;
        mesh.position.x += (meshInfo.targetX - mesh.position.x) * 0.12;
        
        // Lerp scale height and offset position Y accordingly
        meshInfo.currentHeight += (meshInfo.targetHeight - meshInfo.currentHeight) * 0.12;
        mesh.scale.y = meshInfo.currentHeight;
        mesh.position.y = meshInfo.currentHeight / 2 - 0.5; // keeps bottom anchored on the grid plane

        mesh.position.z += (targetZ - mesh.position.z) * 0.12;

        // Lerp material color
        mesh.material.color.lerp(meshInfo.targetMat.color, 0.12);
        if (meshInfo.targetMat.emissive) {
          mesh.material.emissive.lerp(meshInfo.targetMat.emissive, 0.12);
          mesh.material.emissiveIntensity += (meshInfo.targetMat.emissiveIntensity - mesh.material.emissiveIntensity) * 0.12;
        } else {
          mesh.material.emissive.setHex(0x000000);
        }
      });

      // Remove meshes that are no longer present
      Object.keys(meshesRef.current).forEach((id) => {
        if (!activeMeshIds.has(id)) {
          const meshInfo = meshesRef.current[id];
          visualizerGroup.remove(meshInfo.mesh);
          meshInfo.mesh.geometry.dispose();
          meshInfo.mesh.material.dispose();
          delete meshesRef.current[id];
        }
      });

      // 6. Project 3D Coordinates to 2D for HTML Label Overlay
      const coords = [];
      const tempV = new THREE.Vector3();

      ids.forEach((id, index) => {
        const meshInfo = meshesRef.current[id];
        if (meshInfo) {
          const val = currentList[index];
          const mesh = meshInfo.mesh;

          // Get top center of the 3D bar in world space
          tempV.set(mesh.position.x, mesh.position.y + meshInfo.currentHeight / 2 + 0.1, mesh.position.z);
          tempV.project(camera);

          // Convert to client width/height coordinates
          const x2d = (tempV.x * 0.5 + 0.5) * width;
          const y2d = (-tempV.y * 0.5 + 0.5) * height;

          // Get active pointers
          const activePointers = pointers[index] || [];

          coords.push({
            id,
            x: x2d,
            y: y2d,
            val,
            pointers: activePointers
          });
        }
      });

      setLabelCoords(coords);

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(tick);
    };

    tick();

    // 7. Handle Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      width = container.clientWidth || 600;
      height = container.clientHeight || 280;

      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    // Cleanups
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      resizeObserver.disconnect();
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      // Clean up meshes
      Object.values(meshesRef.current).forEach((m) => {
        visualizerGroup.remove(m.mesh);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
      });
      meshesRef.current = {};

      baseMaterial.dispose();
      compareMaterial.dispose();
      swapMaterial.dispose();
      changedMaterial.dispose();

      ambientLight.dispose();
      dirLight.dispose();
      pointLight.dispose();
      gridHelper.dispose();
      
      renderer.dispose();
    };
  }, [listKey, variables, prevVariables, actionType]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 250,
        background: '#ffffff',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 3D WebGL Canvas */}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', cursor: 'grab' }} />

      {/* Floating 2D HTML Labels on top of WebGL Canvas */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
        {labelCoords.map((coord) => (
          <div
            key={coord.id}
            style={{
              position: 'absolute',
              left: coord.x,
              top: coord.y,
              transform: 'translate(-50%, -100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4
            }}
          >
            {/* Value Label Card */}
            <div
              style={{
                background: '#0F172A', // Slate dark card
                color: '#F8FAFC',
                fontFamily: 'monospace',
                fontSize: 11.5,
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 5,
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(255,255,255,0.1)'
              }}
            >
              {String(coord.val)}
            </div>

            {/* Pointers badges indicating indices variables (e.g. i, j) */}
            {coord.pointers.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 3,
                  marginTop: 2
                }}
              >
                {coord.pointers.map(ptrName => (
                  <div
                    key={ptrName}
                    style={{
                      background: actionType === 'SWAP' ? '#EF4444' : '#10B981',
                      color: '#ffffff',
                      fontSize: 8.5,
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: 3,
                      fontFamily: 'monospace',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                      animation: 'bounce 0.8s infinite alternate'
                    }}
                  >
                    {ptrName}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Stack/Scalar Registers Sidebar overlay (right side) */}
      {stackVars.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 160,
            maxHeight: 'calc(100% - 20px)',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05)',
            overflowY: 'auto',
            zIndex: 20
          }}
          className="sandbox-scroll"
        >
          <div style={{ fontSize: 9, color: '#64748B', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 4 }}>
            Stack Memory
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stackVars.map((v) => (
              <div
                key={v.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: v.isChanged ? 'rgba(245, 158, 11, 0.08)' : 'rgba(15, 23, 42, 0.02)',
                  border: v.isChanged ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(15, 23, 42, 0.03)',
                  borderRadius: 5,
                  padding: '3px 6px',
                  transition: 'all 0.3s'
                }}
              >
                <span style={{ fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: '#334155' }}>
                  {v.key}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    color: v.isChanged ? '#D97706' : (v.type === 'number' ? '#2563EB' : (v.type === 'boolean' ? '#059669' : '#475569'))
                  }}
                >
                  {v.type === 'dict' ? '{...}' : String(v.val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Styles for mini bounce animation */}
      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}
