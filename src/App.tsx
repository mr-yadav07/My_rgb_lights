import React, { useState, useEffect, useRef } from "react";
import { 
  motion, 
  AnimatePresence 
} from "motion/react";
import { 
  Bluetooth, 
  BluetoothOff, 
  Wifi, 
  WifiOff, 
  Copy, 
  Check, 
  Settings, 
  Activity, 
  Power, 
  Cpu, 
  RefreshCw, 
  Info, 
  ChevronRight, 
  Volume2, 
  Layers, 
  FileCode, 
  Sparkles,
  Smartphone
} from "lucide-react";
import { androidCodeFiles, CodeFile } from "./androidSource";

export default function App() {
  // Device state simulators
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(true);
  const [espInRange, setEspInRange] = useState(true);
  
  // App BLE state machines
  const [connectionState, setConnectionState] = useState<"DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING">("DISCONNECTED");
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevices, setFoundDevices] = useState<{ name: string; address: string; rssi: number }[]>([]);
  const [lastCommand, setLastCommand] = useState<string>("SYSTEM_IDLE");
  
  // Controller settings (optimistic local UI states)
  const [powerOn, setPowerOn] = useState(true);
  const [activeEffect, setActiveEffect] = useState(1); // 0=Off, 1=Solid, 2=Rainbow, 3=Breathe, 4=Chase
  const [color, setColor] = useState({ r: 255, g: 0, b: 255 }); // Default: Neon Magenta
  const [brightness, setBrightness] = useState(200);

  // Throttling tracking
  const [isDraggingBrightness, setIsDraggingBrightness] = useState(false);
  const lastWriteTime = useRef<number>(0);

  // LED Strip Animation ticks
  const [hueTick, setHueTick] = useState(0);
  const [breatheTick, setBreatheTick] = useState(0);
  const [chaseIdx, setChaseIdx] = useState(0);

  // Tab state for the Kotlin Source File Viewer
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [copiedFileIndex, setCopiedFileIndex] = useState<number | null>(null);

  // Canvas ref for color wheel
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMouseDown = useRef(false);

  // Interactive console feed logs
  const [sysLogs, setSysLogs] = useState<string[]>([
    "System booted. Waiting for scan instructions...",
  ]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setSysLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 24)]);
  };

  // Run simulated clock/animations for LED effects
  useEffect(() => {
    const interval = setInterval(() => {
      if (!powerOn || activeEffect === 0) return;
      
      if (activeEffect === 2) {
        // Rainbow cycle
        setHueTick(prev => (prev + 3) % 360);
      } else if (activeEffect === 3) {
        // Breathing cycle (sine wave tracker)
        setBreatheTick(prev => (prev + 0.05) % (Math.PI * 2));
      } else if (activeEffect === 4) {
        // Chase cycle
        setChaseIdx(prev => (prev + 1) % 16);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [powerOn, activeEffect]);

  // Monitor simulated signal loss
  useEffect(() => {
    if (!espInRange && connectionState === "CONNECTED") {
      setConnectionState("RECONNECTING");
      addLog("GATT link lost unexpectedly! Initiating BleManager auto-reconnect loop.");
    }
  }, [espInRange, connectionState]);

  // Simulated auto-reconnection loop
  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout;
    if (connectionState === "RECONNECTING") {
      const attemptReconnect = () => {
        if (!espInRange) {
          reconnectTimeout = setTimeout(() => {
            addLog("BleManager reconnection attempt failed (Target node advertisements unreachable).");
            attemptReconnect();
          }, 3000);
        } else {
          setConnectionState("CONNECTED");
          addLog("GATT connection re-established successfully! Syncing controller states.");
          writeBleCommand(`POWER:${powerOn ? 1 : 0}`);
          if (powerOn) {
            writeBleCommand(`BRIGHT:${brightness}`);
            writeBleCommand(`EFFECT:${activeEffect}`);
            if (activeEffect === 1) {
              writeBleCommand(`COLOR:${color.r},${color.g},${color.b}`);
            }
          }
        }
      };

      attemptReconnect();
    }

    return () => clearTimeout(reconnectTimeout);
  }, [connectionState, espInRange]);

  // Start BLE scans
  const startScanningSim = () => {
    if (!bluetoothEnabled) {
      addLog("BLE Scan failed: Host Bluetooth hardware is toggled OFF.");
      return;
    }
    setIsScanning(true);
    setFoundDevices([]);
    addLog("Scanning started. Scanning settings: SCAN_MODE_LOW_LATENCY, Filter service UUID: 19b10000-e8f2-537e-4f6c-d104768a1214");
    
    setTimeout(() => {
      if (espInRange) {
        setFoundDevices([
          { name: "ESP32-RGB-Light", address: "BC:DD:C2:8A:12:14", rssi: -58 }
        ]);
        addLog("Found device 'ESP32-RGB-Light' matching filtering profile.");
      } else {
        addLog("Scanning idle. No active advertisement boards discovered in RF proximity.");
      }
    }, 1500);

    // Auto timeout after 10 seconds
    setTimeout(() => {
      setIsScanning(false);
    }, 10000);
  };

  const stopScanningSim = () => {
    setIsScanning(false);
    addLog("Scanning terminated.");
  };

  const connectDeviceSim = (device: { name: string; address: string }) => {
    setIsScanning(false);
    setConnectionState("CONNECTING");
    addLog(`Initiating connectGatt() to device address ${device.address}...`);
    
    setTimeout(() => {
      setConnectionState("CONNECTED");
      addLog("Device handshake successful. Service discovery complete: Characteristic 19b10001 (WRITE, WRITE_NO_RESPONSE) is active.");
      // Synchronize initial state
      writeBleCommand(`POWER:1`);
      writeBleCommand(`BRIGHT:${brightness}`);
      writeBleCommand(`COLOR:${color.r},${color.g},${color.b}`);
    }, 1200);
  };

  const disconnectDeviceSim = () => {
    setConnectionState("DISCONNECTED");
    addLog("GATT close() called. Terminated session.");
  };

  // Safe BLE writing emulator
  const writeBleCommand = (cmd: string, writeType: "NO_RESPONSE" | "DEFAULT" = "NO_RESPONSE") => {
    if (connectionState !== "CONNECTED") return;
    setLastCommand(cmd);
    addLog(`[BLE TX] ${cmd} (Write Type: ${writeType})`);
  };

  // Color picker event handlers
  const handleColorPick = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx*dx + dy*dy);
    const maxRadius = Math.min(centerX, centerY) - 8;

    if (distance <= maxRadius) {
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      
      const saturation = distance / maxRadius;
      const rgb = hsvToRgb(angle, saturation, 1.0);
      setColor(rgb);
      
      // Auto toggle to solid output if we shift colors
      setActiveEffect(1);
      
      // Send BLE state immediately
      writeBleCommand(`COLOR:${rgb.r},${rgb.g},${rgb.b}`);
    }
  };

  // Draw HSV Color ring canvas
  useEffect(() => {
    if (connectionState !== "CONNECTED" || !powerOn || activeEffect !== 1) return;
    
    // Tiny delay to let canvas mount
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(centerX, centerY) - 8;

      ctx.clearRect(0,0,width,height);

      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius) {
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            if (angle < 0) angle += 360;
            
            const sat = dist / radius;
            const color = hsvToRgb(angle, sat, 1.0);
            
            const pixelIdx = (y * width + x) * 4;
            data[pixelIdx] = color.r;
            data[pixelIdx + 1] = color.g;
            data[pixelIdx + 2] = color.b;
            data[pixelIdx + 3] = 255;
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // Draw active cursor target marker
      // Re-map active rgb coordinates to angle & saturation
      const hsv = rgbToHsv(color.r, color.g, color.b);
      const cursorAngleRad = hsv.h * (Math.PI / 180);
      const cursorRadius = hsv.s * radius;
      const cx = centerX + cursorRadius * Math.cos(cursorAngleRad);
      const cy = centerY + cursorRadius * Math.sin(cursorAngleRad);

      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }, 100);

    return () => clearTimeout(timer);
  }, [connectionState, powerOn, activeEffect, color]);

  // Color mapping converters
  function hsvToRgb(h: number, s: number, v: number) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHsv(r: number, g: number, b: number) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (max !== min) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s, v };
  }

  // Handle slide ticks vs slide release
  const handleBrightnessChange = (val: number) => {
    setBrightness(val);
    const now = Date.now();
    // Throttle high-frequency drag events to roughly every 100ms
    if (now - lastWriteTime.current > 100) {
      writeBleCommand(`BRIGHT:${Math.round(val)}`);
      lastWriteTime.current = now;
    }
  };

  const handleBrightnessRelease = () => {
    setIsDraggingBrightness(false);
    writeBleCommand(`BRIGHT:${Math.round(brightness)}`, "DEFAULT");
  };

  // Render individual LED color node state based on selected effect
  const getLedColor = (index: number): string => {
    if (!powerOn || activeEffect === 0) return "rgba(30, 30, 40, 0.4)";
    const brightnessRatio = brightness / 255;

    switch (activeEffect) {
      case 1: // Solid
        return `rgba(${color.r}, ${color.g}, ${color.b}, ${brightnessRatio})`;
      case 2: // Rainbow Carousel
        const pixelHue = (hueTick + index * 22.5) % 360;
        const rgb = hsvToRgb(pixelHue, 1.0, 1.0);
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${brightnessRatio})`;
      case 3: // Breathe glow cycle
        const breatheOpacity = (Math.sin(breatheTick) + 1) / 2 * brightnessRatio;
        return `rgba(${color.r}, ${color.g}, ${color.b}, ${breatheOpacity})`;
      case 4: // Chase light run
        const relativeDist = (index - chaseIdx + 16) % 16;
        if (relativeDist === 0) {
          // Lead pixel
          return `rgba(${color.r}, ${color.g}, ${color.b}, ${brightnessRatio})`;
        } else if (relativeDist === 1) {
          // Trail pixel 1
          return `rgba(${color.r}, ${color.g}, ${color.b}, ${brightnessRatio * 0.6})`;
        } else if (relativeDist === 2) {
          // Trail pixel 2
          return `rgba(${color.r}, ${color.g}, ${color.b}, ${brightnessRatio * 0.25})`;
        } else {
          return "rgba(20, 20, 30, 0.35)";
        }
      default:
        return "rgba(30,30,40,0.4)";
    }
  };

  // Copy code helper
  const handleCopyCode = (index: number) => {
    const file = androidCodeFiles[index];
    navigator.clipboard.writeText(file.content);
    setCopiedFileIndex(index);
    setTimeout(() => setCopiedFileIndex(null), 2000);
  };

  return (
    <div id="workbench_root" className="min-h-screen sophisticated-bg text-gray-200 flex flex-col font-sans selection:bg-[#F27D26] selection:text-black">
      {/* Visual Header */}
      <header id="workbench_header" className="px-8 py-5 bg-[#0B0B0F]/95 border-b border-white/[0.05] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 bg-gradient-to-tr from-[#FFD700] to-[#F27D26] rounded-xl shadow-lg shadow-orange-500/10">
            <Cpu className="w-6 h-6 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-extrabold text-white tracking-tight">NeoGlow</h1>
            <p className="text-xs text-white/50">ESP32 Hardware Controller</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold bg-emerald-500/10 text-[#4ade80] border border-emerald-500/20 px-4 py-2 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>ESP32-RGB-Light</span>
        </div>
      </header>

      {/* Main Grid View */}
      <main id="workbench_grid" className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* COLUMN 1: THE SMARTPHONE SIMULATOR (Span 4) */}
        <section id="phone-container" className="lg:col-span-4 flex flex-col items-center justify-center">
          <h2 className="text-sm font-semibold tracking-wider text-gray-400 uppercase mb-3 text-center self-stretch flex items-center justify-center gap-2">
            <Smartphone className="w-4 h-4 text-[#F27D26]" />
            Android APP Emulator
          </h2>

          <div id="android_phone_frame" className="relative w-[340px] h-[670px] bg-[#121216] rounded-[48px] border-[14px] border-[#22222D] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col ring-1 ring-white/5">
            {/* Phone Speaker Cutout */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-20 h-4 bg-black rounded-b-xl z-50 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-[#111122]"></div>
            </div>

            {/* Android Status Bar */}
            <div className="h-7 bg-black flex justify-between items-center px-6 text-[10px] font-semibold text-gray-400 select-none z-40">
              <span>10:12 AM</span>
              <div className="flex items-center gap-1.5">
                {bluetoothEnabled ? (
                  <Bluetooth className="w-3.5 h-3.5 text-[#F27D26]" />
                ) : (
                  <BluetoothOff className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className="text-xs">LTE</span>
                <div className="w-4 h-2.5 border border-gray-400 rounded-sm p-[1px] flex items-center">
                  <div className="w-2.5 h-full bg-gray-400 rounded-2xs"></div>
                </div>
              </div>
            </div>

            {/* Simulated Phone Screen Contents */}
            <div id="android_screen_viewport" className="flex-1 bg-[#0B0B0F] relative overflow-hidden flex flex-col">
              
              {/* STAGE A: Runtime Permissions Alert Box */}
              {!permissionsGranted && (
                <div id="android_permissions_modal" className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 z-50">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-5 w-full shadow-2xl"
                  >
                    <div className="flex justify-center mb-3 text-[#F27D26]">
                      <Bluetooth className="w-10 h-10 animate-pulse" />
                    </div>
                    <h3 className="text-sm font-semibold text-white text-center mb-2">
                      Permissions Requested
                    </h3>
                    <p className="text-xs text-gray-400 text-center leading-relaxed mb-4">
                      The ESP32 Controller app requires <span className="text-white">Device Scanning</span>, <span className="text-white">Bluetooth connections</span>, and <span className="text-white">Location discovery</span> (for pre-Android 12 compatibility) permission flags.
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        id="btn_allow_permissions"
                        onClick={() => {
                          setPermissionsGranted(true);
                          addLog("Runtime BLE/Location permissions granted on Android device.");
                        }}
                        className="w-full py-2 bg-[#1E5CFF] hover:bg-blue-600 active:scale-98 transition text-white rounded-lg text-xs font-bold"
                      >
                        Grant Runtime Permissions
                      </button>
                      <button
                        onClick={() => addLog("Warning: Permissions denied. BLE actions disabled.")}
                        className="w-full py-2 bg-transparent hover:bg-white/5 text-gray-500 rounded-lg text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}

              {/* STAGE B: Bluetooth Adapter Toggle Modal */}
              {permissionsGranted && !bluetoothEnabled && (
                <div id="android_bluetooth_modal" className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 z-50">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-5 w-full shadow-2xl"
                  >
                    <div className="flex justify-center mb-3 text-orange-400">
                      <BluetoothOff className="w-10 h-10" />
                    </div>
                    <h3 className="text-sm font-semibold text-white text-center mb-2">
                      Bluetooth Required
                    </h3>
                    <p className="text-xs text-gray-400 text-center leading-relaxed mb-4">
                      An application requests to turn on your system Bluetooth antenna to identify local nodes.
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        id="btn_enable_bluetooth"
                        onClick={() => {
                          setBluetoothEnabled(true);
                          addLog("Android System Bluetooth enabled by user callback.");
                        }}
                        className="w-full py-2 bg-[#1E5CFF] hover:bg-blue-600 active:scale-98 transition text-white rounded-lg text-xs font-bold"
                      >
                        Allow Bluetooth
                      </button>
                      <button
                        onClick={() => addLog("Bluetooth intent canceled.")}
                        className="w-full py-2 bg-transparent hover:bg-white/5 text-gray-500 rounded-lg text-xs font-medium"
                      >
                        Deny
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}

              {/* SCREEN STAGE: Scanned Scan Interface */}
              {permissionsGranted && bluetoothEnabled && connectionState === "DISCONNECTED" && (
                <div id="screen_scan_view" className="flex-1 p-5 flex flex-col justify-between">
                  <div>
                    <div className="mt-2 mb-1">
                      <h3 className="text-xl font-bold font-display text-white">ESP32 RGB</h3>
                      <p className="text-xs text-slate-500">WS2812B BLE Device Hub</p>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <span className="text-xs text-gray-400 font-medium">Auto Scanning...</span>
                      <button 
                        id="btn_scan_refresh"
                        onClick={() => {
                          if (isScanning) stopScanningSim();
                          else startScanningSim();
                        }}
                        className={`p-1.5 rounded-full ${isScanning ? "bg-blue-500/10 text-blue-400 animate-spin" : "bg-[#1E1E2C] text-white hover:bg-slate-800"}`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Devices list container */}
                    <div className="mt-3 space-y-2 h-[340px] overflow-y-auto pr-1">
                      {foundDevices.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center p-6 bg-[#08080C] border border-[#1A1A24] rounded-xl text-center">
                          <RefreshCw className="w-8 h-8 text-blue-500/40 animate-spin mb-3" />
                          <h4 className="text-xs font-semibold text-gray-400">Scanning RF Spectrum</h4>
                          <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                            Looking for BLE ServiceUUID 19b10000...
                          </p>
                        </div>
                      ) : (
                        foundDevices.map((dev, i) => (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            onClick={() => connectDeviceSim(dev)}
                            className="bg-[#12121A] hover:bg-[#1E1E2C]/80 border border-[#1E1E2D] hover:border-[#F27D26]/50 rounded-xl p-3.5 flex items-center justify-between cursor-pointer transition active:scale-98"
                          >
                            <div>
                              <h4 className="text-xs font-bold text-white flex items-center gap-2">
                                {dev.name}
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              </h4>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">{dev.address}</p>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[9px] text-slate-400 font-mono font-semibold">{dev.rssi} dBm</span>
                              <span className="text-[9px] text-[#F27D26] font-semibold uppercase tracking-wider mt-1">CH-0</span>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Scan Instructions box */}
                  <div className="bg-[#12111A] border border-[#1C1A2E] rounded-xl p-3">
                    <div className="flex gap-2 items-start">
                      <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-300 font-display">ESP32 Device Node</h4>
                        <p className="text-[10px] text-slate-500 leading-normal mt-0.5">
                          Ensure the Neopixel strip is connected to GPIO4 and configured with targets. Show local results to trigger the BLE stack.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SCREEN STAGE: Connecting interface */}
              {permissionsGranted && bluetoothEnabled && connectionState === "CONNECTING" && (
                <div id="screen_connecting_view" className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 rounded-full border-4 border-[#F27D26]/20 border-t-[#F27D26] animate-spin"></div>
                    <Bluetooth className="w-6 h-6 text-[#F27D26] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <h3 className="text-sm font-bold text-white font-display">Connecting...</h3>
                  <p className="text-xs text-slate-500 mt-2 max-w-[200px] leading-relaxed mx-auto">
                    Sending connectGatt requests to BLE characteristic UUID 19b10001
                  </p>
                </div>
              )}

              {/* SCREEN STAGE: Connected Active Control panel */}
              {permissionsGranted && bluetoothEnabled && (connectionState === "CONNECTED" || connectionState === "RECONNECTING") && (
                <div id="screen_control_view" className="flex-1 p-4 flex flex-col justify-between overflow-y-auto">
                  
                  {/* Status header */}
                  <div>
                    <div className="flex items-center justify-between border-b border-[#1E1E2C] pb-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${connectionState === "CONNECTED" ? "bg-emerald-500 animate-pulse" : "bg-amber-500 animate-spin"}`}></span>
                        <div className="text-left">
                          <h4 className="text-[11px] font-bold text-white">ESP32-RGB-Light</h4>
                          <p className="text-[9px] text-[#22C55E] flex items-center gap-0.5">
                            {connectionState === "CONNECTED" ? "GATT Bound" : "GATT Link Recovery..."}
                          </p>
                        </div>
                      </div>
                      <button 
                        id="btn_device_disconnect"
                        onClick={disconnectDeviceSim}
                        className="text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2 py-1 rounded font-bold"
                      >
                        Disconnect
                      </button>
                    </div>

                    {/* Central Glowing Orb representation */}
                    <div className="py-2 flex flex-col items-center justify-center relative">
                      <div className="relative w-28 h-28 flex items-center justify-center">
                        {/* Glow halo */}
                        <div 
                          className="absolute inset-[4px] blur-xl rounded-full transition-all duration-300 pointer-events-none"
                          style={{
                            background: powerOn && activeEffect !== 0
                              ? (activeEffect === 2 
                                  ? `conic-gradient(from ${hueTick}deg, red, yellow, lime, aqua, blue, magenta, red)`
                                  : `radial-gradient(circle, rgba(${color.r},${color.g},${color.b},1) 0%, rgba(${color.r},${color.g},${color.b},0.3) 50%, rgba(242, 125, 38, 0) 100%)`)
                              : "transparent",
                            boxShadow: powerOn && activeEffect !== 0 
                              ? `0 0 40px rgba(${color.r},${color.g},${color.b}, 0.5)` 
                              : "none"
                          }}
                        />
                        {/* Solid Glass Circle with reflection */}
                        <div 
                          id="glowing_center_orb"
                          className="w-24 h-24 rounded-full border border-white/[0.15] relative transition-all duration-300 overflow-hidden"
                          style={{
                            background: powerOn && activeEffect !== 0
                              ? (activeEffect === 2 
                                  ? `conic-gradient(from ${hueTick}deg, red, yellow, lime, aqua, blue, magenta, red)`
                                  : `radial-gradient(circle at 30% 30%, rgb(${Math.min(color.r + 100, 255)}, ${Math.min(color.g + 100, 255)}, ${Math.min(color.b + 100, 255)}), rgb(${color.r}, ${color.g}, ${color.b}))`)
                              : "#12121A",
                            boxShadow: powerOn && activeEffect !== 0 
                              ? `inset -6px -6px 20px rgba(0,0,0,0.5)` 
                              : "none",
                            opacity: powerOn ? (brightness / 255) * 0.9 + 0.1 : 0.2
                          }}
                        >
                          {/* Orb reflection highlight */}
                          <div className="orb-reflection-custom" />
                        </div>
                      </div>
                      <div className="text-center mt-2.5">
                        <span className="text-[10px] font-bold text-white uppercase tracking-wider block font-display">
                          {powerOn && activeEffect !== 0 ? (activeEffect === 2 ? "Rainbow Palette" : activeEffect === 3 ? "Breathe Mode" : activeEffect === 4 ? "Chase Mode" : "Sunset Amber Solid") : "System Off"}
                        </span>
                        <span className="text-[9px] font-mono text-slate-500 mt-0.5 block uppercase tracking-wider">
                          {powerOn && activeEffect !== 0 ? `${Math.round(brightness / 255 * 100)}% Intensity` : "Device Idle"}
                        </span>
                      </div>
                    </div>

                    {/* Power Switch slider card as a premium Power Pill */}
                    <div className="mb-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40 block mb-1.5 pl-1 font-display">Device Control</span>
                      <button
                        id="btn_power_toggle"
                        onClick={() => {
                          const nextState = !powerOn;
                          setPowerOn(nextState);
                          writeBleCommand(`POWER:${nextState ? 1 : 0}`, "DEFAULT");
                          if (!nextState) {
                            setActiveEffect(0);
                            addLog("Strip Power OFF. Sent ASCII write COMMAND POWER:0");
                          } else {
                            setActiveEffect(1);
                            addLog("Strip Power ON. Sent ASCII write COMMAND POWER:1");
                          }
                        }}
                        className={`w-full py-3.5 rounded-[100px] text-xs font-bold uppercase tracking-wider transition ${powerOn ? "power-pill-active-custom" : "power-pill-custom"} text-center outline-none`}
                      >
                        System Power: {powerOn ? "ON" : "OFF"}
                      </button>
                    </div>

                    {/* Dynamic HSV picker container */}
                    {powerOn && activeEffect === 1 && (
                      <div className="mt-3 bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-3 flex flex-col items-center glass-card-custom">
                        <span className="text-[10px] font-bold text-slate-400 self-start mb-2 font-display">HSV Color Wheel Target</span>
                        <div className="relative flex justify-center">
                          <canvas 
                            ref={canvasRef}
                            width="140"
                            height="140"
                            className="bg-transparent cursor-crosshair rounded-full border border-slate-800"
                            onMouseDown={(e) => { isMouseDown.current = true; handleColorPick(e); }}
                            onMouseMove={(e) => { if (isMouseDown.current) handleColorPick(e); }}
                            onMouseUp={() => { isMouseDown.current = false; }}
                            onMouseLeave={() => { isMouseDown.current = false; }}
                            onTouchStart={(e) => { isMouseDown.current = true; handleColorPick(e); }}
                            onTouchMove={(e) => { if (isMouseDown.current) handleColorPick(e); }}
                            onTouchEnd={() => { isMouseDown.current = false; }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Brightness slider container */}
                    {powerOn && (
                      <div className="mt-3 bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-3 glass-card-custom">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1 font-display">
                          <span>Brightness</span>
                          <span className="font-mono">{Math.round(brightness / 255 * 100)}%</span>
                        </div>
                        <input 
                          id="slider_brightness"
                          type="range"
                          min="0"
                          max="255"
                          value={brightness}
                          onChange={(e) => handleBrightnessChange(Number(e.target.value))}
                          onMouseDown={() => setIsDraggingBrightness(true)}
                          onMouseUp={handleBrightnessRelease}
                          onTouchStart={() => setIsDraggingBrightness(true)}
                          onTouchEnd={handleBrightnessRelease}
                          className="w-full select-none accent-[#F27D26] h-1.5 bg-[#1E1E2D] rounded-lg cursor-pointer my-2"
                        />
                      </div>
                    )}

                    {/* Active strip preset options */}
                    <div className="mt-3">
                      <span className="text-[10px] font-semibold text-white/40 pl-1 uppercase tracking-wider font-display">Effect Selection</span>
                      <div className="grid grid-cols-5 gap-1.5 mt-1.5">
                        {["Off", "Solid", "Rainbow", "Breathe", "Chase"].map((effectName, index) => {
                          const isSelected = activeEffect === index;
                          return (
                            <button
                              id={`btn_effect_mode_${index}`}
                              key={index}
                              onClick={() => {
                                setActiveEffect(index);
                                if (index === 0) {
                                  setPowerOn(false);
                                  writeBleCommand("POWER:0", "DEFAULT");
                                } else {
                                  setPowerOn(true);
                                  writeBleCommand("POWER:1", "DEFAULT");
                                  writeBleCommand(`EFFECT:${index}`, "DEFAULT");
                                }
                              }}
                              className={`py-2.5 px-0.5 rounded-xl text-[9px] font-bold transition duration-200 ${isSelected ? "chip-active-custom shadow-md shadow-[#F27D26]/20 text-black" : "chip-custom text-white/60"}`}
                            >
                              {effectName}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  </div>

                  {/* Android Bottom Debug Command Output */}
                  <div className="mt-3">
                    <div className="bg-black/85 font-mono text-[9px] p-2 rounded-lg border border-[#1A1A24] text-emerald-400 flex items-center justify-between">
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[8px] tracking-widest text-[#FF416C] font-black uppercase">DEBUG_RX:</span>
                        <span className="truncate max-w-[160px] font-semibold">{lastCommand}</span>
                      </div>
                      <span className="text-[8px] bg-[#F27D26]/15 px-2 py-0.5 rounded text-[#F27D26] shrink-0 font-bold">W_NO_R</span>
                    </div>
                  </div>

                </div>
              )}

              {/* End Android Phone contents screen */}
            </div>

            {/* Android Home Navigation Pill */}
            <div className="h-6 bg-black flex justify-center items-center select-none pb-1.5">
              <div className="w-24 h-1 bg-[#444455] rounded-full"></div>
            </div>
          </div>
        </section>

        {/* COLUMN 2: HARDWARE LABORATORY (Span 4) */}
        <section id="hardware-panel" className="lg:col-span-4 flex flex-col justify-between gap-6">
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold tracking-wider text-gray-400 uppercase mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#F27D26]" />
              ESP32 & LED Hardware Visualizer
            </h2>

            {/* Simulated Desktop Workbench Container */}
            <div id="visualizer_workbench" className="p-5 shadow-inner glass-card-custom rounded-[28px]">
              <div className="flex items-center justify-between border-b border-white/5 pb-2.5 mb-4">
                <span className="text-xs font-bold text-slate-300">Target Node Board Visualizer</span>
                <span className="inline-block px-2.5 py-0.5 bg-emerald-500/10 rounded-full text-[9px] font-bold text-emerald-400 uppercase">
                  SIM_CLIENT ACTIVE
                </span>
              </div>

              {/* Graphical ESP32 Model */}
              <div className="bg-[#12121A]/50 border border-white/[0.05] p-4 rounded-xl flex gap-3 relative overflow-hidden">
                <div className="p-1 px-1.5 bg-[#1C1C28]/60 rounded border border-slate-700/60 flex flex-col justify-between text-[8px] font-mono font-bold text-slate-400 select-none">
                  <span>3V3</span>
                  <span className="text-emerald-500">GND</span>
                  <span className="text-orange-400">GPIO4</span>
                  <span>EN</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black font-display text-white">NodeMCU ESP32-WROOM</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  </div>
                  <p className="text-[9px] text-slate-500 font-mono mt-0.5">WiFi + BLE dual SoC system client</p>
                  
                  {/* Blinking pin indicators */}
                  <div className="mt-3.5 flex items-center gap-3">
                    <div className="flex items-center gap-1 font-mono text-[9px]">
                      <span className="w-2 h-2 rounded bg-amber-400 animate-ping"></span>
                      <span className="text-slate-400 font-medium">RX2</span>
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[9px]">
                      <span className="w-2 h-2 rounded bg-cyan-400 animate-pulse"></span>
                      <span className="text-slate-400 font-medium font-semibold text-slate-400">TX2</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Addressable WS2812 LED light strip representation */}
              <div className="mt-5">
                <h3 className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                  <span>WS2812B Addressable Neopixel Ribbon</span>
                  <span className="text-[10px] text-slate-400 font-mono">16 Pixels</span>
                </h3>

                {/* Actual Glow Strip Container with subtle glassy design */}
                <div 
                  id="hardware_led_strip_chassis" 
                  className="bg-[#050508] border border-white/[0.05] p-3 rounded-xl flex items-center justify-between gap-1.5 overflow-x-auto"
                >
                  {Array.from({ length: 16 }).map((_, idx) => {
                    const ledColor = getLedColor(idx);
                    return (
                      <div 
                        key={idx}
                        className="relative w-4 h-4 shrink-0 rounded-full transition-all duration-150 border border-slate-800"
                        style={{
                          backgroundColor: ledColor,
                          boxShadow: powerOn && activeEffect !== 0 
                            ? `0 0 10px ${ledColor}, 0 0 4px ${ledColor}` 
                            : "none"
                        }}
                      />
                    );
                  })}
                </div>

                <div className="mt-2.5 flex justify-between text-[10px] font-mono text-slate-500 bg-[#08080A]/60 px-2 py-1 rounded">
                  <span>PIN_4 (DATA)</span>
                  <span>PWM LED STACK</span>
                </div>
              </div>
            </div>

            {/* Proximity / Error Sandbox */}
            <div id="visualizer_sandbox_params" className="mt-4 p-5 glass-card-custom rounded-[28px]">
              <h3 className="text-xs font-bold text-slate-300 mb-2 font-display">Simulate Physical Connection Dropouts</h3>
              <p className="text-[10px] text-slate-500 mb-3.5 leading-relaxed">
                Toggle node range on/off to test the Android BLE GATT client auto-reconcile state machine.
              </p>

              <div className="flex items-center justify-between bg-[#111116] border border-white/[0.05] rounded-xl p-3">
                <div className="flex items-center gap-2">
                  {espInRange ? (
                    <Wifi className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-red-500" />
                  )}
                  <span className="text-xs font-bold text-white">
                    {espInRange ? "Node In Range" : "Node Out of Range (Unplugged)"}
                  </span>
                </div>
                <div className="relative">
                  <button
                    id="btn_simulate_signal_drop"
                    onClick={() => {
                      const nextVal = !espInRange;
                      setEspInRange(nextVal);
                      addLog(`Physical Simulation: ESP32 device node power status toggled to ${nextVal ? "ON" : "OFF"}`);
                    }}
                    className={`px-3 py-1 text-[10px] rounded font-bold uppercase transition ${espInRange ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"}`}
                  >
                    {espInRange ? "Sever Link" : "Plug Node Info"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Console feed */}
          <div className="p-5 flex-1 min-h-[140px] flex flex-col justify-between glass-card-custom rounded-[28px] mt-4">
            <div>
              <div className="flex items-center justify-between border-b border-white/[0.05] pb-1.5 mb-2.5">
                <span className="text-xs font-bold text-slate-300 font-display">Virtual Controller Trace Feed</span>
                <span className="text-[10px] font-mono text-slate-500">ASCII LOGS</span>
              </div>
              <div className="h-32 overflow-y-auto space-y-1 pr-1 font-mono text-[9px] select-text">
                {sysLogs.map((log, i) => (
                  <div key={i} className="text-slate-400 hover:text-white transition-colors">
                    {log}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setSysLogs(["Terminal cleared. Session logging active."])}
              className="text-[9px] text-[#A0A0C0] uppercase tracking-wider font-bold text-left hover:text-white mt-2 self-start"
            >
              Clear Live Feed
            </button>
          </div>
        </section>

        {/* COLUMN 3: JETPACK COMPOSE COMPILATION STUDIO (Span 4) */}
        <section id="code_viewer_panel" className="lg:col-span-4 flex flex-col">
          <h2 className="text-sm font-semibold tracking-wider text-gray-400 uppercase mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#F27D26]" />
            Kotlin & Compose Source Code
          </h2>

          <div id="android_ide_desktop" className="flex-1 overflow-hidden flex flex-col glass-card-custom rounded-[28px]">
            {/* Tab header buttons */}
            <div className="bg-[#12121A]/80 border-b border-white/[0.05] p-1.5 flex overflow-x-auto whitespace-nowrap scrollbar-none items-center gap-1.5">
              {androidCodeFiles.map((file, idx) => (
                <button
                  id={`btn_tab_code_file_${idx}`}
                  key={idx}
                  onClick={() => setSelectedFileIndex(idx)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition duration-150 ${selectedFileIndex === idx ? "bg-[#F27D26] text-black shadow-md shadow-[#F27D26]/20" : "text-gray-400 hover:text-gray-200 hover:bg-white/5"}`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>{file.name}</span>
                </button>
              ))}
            </div>

            {/* Current file description and copy button metadata bar */}
            <div className="px-4 py-2.5 bg-[#0F0F15] border-b border-white/[0.05] flex items-center justify-between text-xs text-gray-500 select-none">
              <span className="font-mono text-gray-400 text-[11px] truncate max-w-[190px]">
                {androidCodeFiles[selectedFileIndex].path}
              </span>
              <button
                id={`btn_copy_code_file_${selectedFileIndex}`}
                onClick={() => handleCopyCode(selectedFileIndex)}
                className="flex items-center gap-1.5 text-[#F27D26] hover:text-[#e06b12] font-bold px-3 py-1.5 rounded-xl bg-[#F27D26]/5 hover:bg-[#F27D26]/10 border border-[#F27D26]/15 transition duration-150"
              >
                {copiedFileIndex === selectedFileIndex ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy File</span>
                  </>
                )}
              </button>
            </div>

            {/* Actual code display area */}
            <div className="flex-1 p-4 bg-[#08080C] overflow-y-auto max-h-[440px] font-mono text-[10px] leading-relaxed relative">
              <pre className="text-slate-300 select-text outline-none whitespace-pre-wrap">
                {androidCodeFiles[selectedFileIndex].content}
              </pre>
            </div>

            {/* Build parameters quick info */}
            <div className="p-3 bg-[#0C0C12] border-t border-[#1A1A24]/90">
              <h4 className="text-[11px] font-bold text-slate-300 mb-1 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                Hardware Protocol Guide
              </h4>
              <p className="text-[10px] text-indigo-300/80 leading-relaxed font-sans">
                Sends UTF-8 data to UUID char <code className="font-mono text-white text-[9px] bg-indigo-500/10 px-1 rounded">19b10001</code>: 
                <br />
                <span className="text-[9px] text-slate-400 font-mono mt-1 block">
                  • Color set: <b className="text-white">COLOR:r,g,b</b> <br />
                  • Brightness set: <b className="text-white">BRIGHT:n</b> <br />
                  • Effect modes: <b className="text-white">EFFECT:n</b> (0=Off, 1=Solid, 2=Rainbow, 3=Breathe, 4=Chase)
                </span>
              </p>
            </div>

          </div>
        </section>

      </main>

      <footer className="py-4 border-t border-[#1A1A24]/80 text-center text-xs text-gray-500 select-none px-6">
        <p>© 2026 ESP32 RGB BLE Controller Lab — Android Kotlin & Jetpack Compose Development Sandbox</p>
      </footer>
    </div>
  );
}
