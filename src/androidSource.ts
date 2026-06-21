export interface CodeFile {
  name: string;
  path: string;
  language: string;
  content: string;
}

export const androidCodeFiles: CodeFile[] = [
  {
    name: "BleManager.kt",
    path: "app/src/main/java/com/example/esp32rgb/BleManager.kt",
    language: "kotlin",
    content: `package com.example.esp32rgb

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING
}

@SuppressLint("MissingPermission")
class BleManager(private val context: Context) {
    private val TAG = "BleManager"

    // Targets specified by the protocol
    val SERVICE_UUID: UUID = UUID.fromString("19b10000-e8f2-537e-4f6c-d104768a1214")
    val CHARACTERISTIC_UUID: UUID = UUID.fromString("19b10001-e8f2-537e-4f6c-d104768a1214")
    val TARGET_DEVICE_NAME = "ESP32-RGB-Light"

    private val bluetoothAdapter: BluetoothAdapter? by lazy {
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager
        bluetoothManager.adapter
    }

    private var bluetoothGatt: BluetoothGatt? = null
    private var writeCharacteristic: BluetoothGattCharacteristic? = null
    private var lastConnectedDevice: BluetoothDevice? = null
    private var shouldReconnect = false
    private val handler = Handler(Looper.getMainLooper())

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _scannedDevices = MutableStateFlow<List<BluetoothDevice>>(emptyList())
    val scannedDevices: StateFlow<List<BluetoothDevice>> = _scannedDevices

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning

    private val _lastCommand = MutableStateFlow<String>("")
    val lastCommand: StateFlow<String> = _lastCommand

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            if (device.name == TARGET_DEVICE_NAME) {
                val currentList = _scannedDevices.value
                if (!currentList.any { it.address == device.address }) {
                    _scannedDevices.value = currentList + device
                }
            }
        }

        override fun onBatchScanResults(results: List<ScanResult>) {
            val filtered = results.map { it.device }
                .filter { it.name == TARGET_DEVICE_NAME }
            val currentList = _scannedDevices.value
            val newList = currentList.toMutableList()
            var changed = false
            for (device in filtered) {
                if (!newList.any { it.address == device.address }) {
                    newList.add(device)
                    changed = true
                }
            }
            if (changed) {
                _scannedDevices.value = newList
            }
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "Scan failed with error code: $errorCode")
            _isScanning.value = false
        }
    }

    fun startScanning() {
        val adapter = bluetoothAdapter ?: return
        if (!adapter.isEnabled) return

        _scannedDevices.value = emptyList()
        val scanner = adapter.bluetoothLeScanner ?: return

        // Filter by Service UUID to scan only our target
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        _isScanning.value = true
        scanner.startScan(listOf(filter), settings, scanCallback)

        // Stop scanning after 10 seconds timeout
        handler.postDelayed({
            if (_isScanning.value) {
                stopScanning()
            }
        }, 10000)
    }

    fun stopScanning() {
        val adapter = bluetoothAdapter ?: return
        val scanner = adapter.bluetoothLeScanner ?: return
        if (_isScanning.value) {
            scanner.stopScan(scanCallback)
            _isScanning.value = false
        }
    }

    fun connect(device: BluetoothDevice) {
        stopScanning()
        _connectionState.value = ConnectionState.CONNECTING
        lastConnectedDevice = device
        shouldReconnect = true
        
        bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        shouldReconnect = false
        _connectionState.value = ConnectionState.DISCONNECTED
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        writeCharacteristic = null
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.d(TAG, "Connected to GATT server.")
                _connectionState.value = ConnectionState.CONNECTED
                // Discover services immediately
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.d(TAG, "Disconnected from GATT server.")
                writeCharacteristic = null
                _connectionState.value = if (shouldReconnect) ConnectionState.RECONNECTING else ConnectionState.DISCONNECTED
                
                if (shouldReconnect) {
                    attemptReconnect()
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                val service = gatt.getService(SERVICE_UUID)
                if (service != null) {
                    val characteristic = service.getCharacteristic(CHARACTERISTIC_UUID)
                    if (characteristic != null) {
                        writeCharacteristic = characteristic
                        Log.d(TAG, "Writable characteristic found successfully!")
                    } else {
                        Log.e(TAG, "Characteristic not found.")
                    }
                } else {
                    Log.e(TAG, "Service not found.")
                }
            } else {
                Log.e(TAG, "Service discovery failed with status: $status")
            }
        }
    }

    private fun attemptReconnect() {
        val device = lastConnectedDevice ?: return
        handler.postDelayed({
            if (_connectionState.value == ConnectionState.RECONNECTING && shouldReconnect) {
                Log.d(TAG, "Attempting connection recovery...")
                bluetoothGatt?.close()
                bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
            }
        }, 3000) // retry every 3 seconds
    }

    fun writeCommand(command: String): Boolean {
        val gatt = bluetoothGatt ?: return false
        val char = writeCharacteristic ?: return false
        
        val data = command.toByteArray(Charsets.UTF_8)
        char.value = data

        // Prefer WRITE_TYPE_NO_RESPONSE for continuous, latency-free updates.
        // Fallback to standard request if GATT dictates.
        val writeTypeNoRespSupported = (char.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
        char.writeType = if (writeTypeNoRespSupported) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        }

        val success = gatt.writeCharacteristic(char)
        if (success) {
            _lastCommand.value = command + " (" + (if (writeTypeNoRespSupported) "No Response" else "Default") + ")"
            Log.d(TAG, "Successfully sent command: $command")
        } else {
            Log.e(TAG, "Failed writing command: $command")
        }
        return success
    }
}
`
  },
  {
    name: "MainActivity.kt",
    path: "app/src/main/java/com/example/esp32rgb/MainActivity.kt",
    language: "kotlin",
    content: `package com.example.esp32rgb

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.example.esp32rgb.ui.screens.MainAppLayout
import com.example.esp32rgb.ui.theme.ESP32RGBControllerTheme

class MainActivity : ComponentActivity() {

    private lateinit var bleManager: BleManager

    // Permission state tracker
    private var permissionsGranted by mutableStateOf(false)

    // Android 12+ (API 31+) permissions
    private val api31Permissions = arrayOf(
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_CONNECT
    )

    // Legacy permissions for scanner below Android 12
    private val legacyPermissions = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION
    )

    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            api31Permissions
        } else {
            legacyPermissions
        }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val allGranted = results.values.all { it }
        permissionsGranted = allGranted
        if (!allGranted) {
            Toast.makeText(this, "BLE scanning requires disabled permissions.", Toast.LENGTH_LONG).show()
        }
    }

    private val bluetoothEnableLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        // Handled in UI layer checking adapter.isEnabled
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bleManager = BleManager(applicationContext)
        checkPermissions()

        setContent {
            ESP32RGBControllerTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val connectionState by bleManager.connectionState.collectAsState()
                    val scannedDevices by bleManager.scannedDevices.collectAsState()
                    val isScanning by bleManager.isScanning.collectAsState()
                    val lastCommand by bleManager.lastCommand.collectAsState()

                    MainAppLayout(
                        connectionState = connectionState,
                        scannedDevices = scannedDevices,
                        isScanning = isScanning,
                        lastCommand = lastCommand,
                        permissionsGranted = permissionsGranted,
                        bluetoothEnabled = isBluetoothEnabled(),
                        onRequestPermissions = { requestPermissions() },
                        onEnableBluetooth = { enableBluetooth() },
                        onStartScan = { bleManager.startScanning() },
                        onStopScan = { bleManager.stopScanning() },
                        onConnect = { device -> bleManager.connect(device) },
                        onDisconnect = { bleManager.disconnect() },
                        onWriteCommand = { cmd -> 
                            val success = bleManager.writeCommand(cmd)
                            if (!success) {
                                Toast.makeText(this, "Write failed", Toast.LENGTH_SHORT).show()
                            }
                        },
                        onOpenSettings = { openAppSettings() }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        checkPermissions()
    }

    private fun checkPermissions() {
        permissionsGranted = requiredPermissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestPermissions() {
        permissionLauncher.launch(requiredPermissions)
    }

    private fun isBluetoothEnabled(): Boolean {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager
        return bluetoothManager.adapter?.isEnabled ?: false
    }

    private fun enableBluetooth() {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter != null && !adapter.isEnabled) {
            val intent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            bluetoothEnableLauncher.launch(intent)
        }
    }

    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
        }
        startActivity(intent)
    }
}
`
  },
  {
    name: "ControlScreen.kt",
    path: "app/src/main/java/com/example/esp32rgb/ui/screens/ControlScreen.kt",
    language: "kotlin",
    content: `package com.example.esp32rgb.ui.screens

import android.bluetooth.BluetoothDevice
import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.RadialGradient
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.esp32rgb.ConnectionState
import kotlinx.coroutines.delay
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

@Composable
fun MainAppLayout(
    connectionState: ConnectionState,
    scannedDevices: List<BluetoothDevice>,
    isScanning: Boolean,
    lastCommand: String,
    permissionsGranted: Boolean,
    bluetoothEnabled: Boolean,
    onRequestPermissions: () -> Unit,
    onEnableBluetooth: () -> Unit,
    onStartScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (BluetoothDevice) -> Unit,
    onDisconnect: () -> Unit,
    onWriteCommand: (String) -> Unit,
    onOpenSettings: () -> Unit
) {
    if (!permissionsGranted) {
        PermissionRequiredScreen(onRequestPermissions, onOpenSettings)
    } else if (!bluetoothEnabled) {
        BluetoothRequiredScreen(onEnableBluetooth)
    } else {
        when (connectionState) {
            ConnectionState.DISCONNECTED -> {
                ScanScreen(
                    scannedDevices = scannedDevices,
                    isScanning = isScanning,
                    onStartScan = onStartScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect
                )
            }
            ConnectionState.CONNECTING,
            ConnectionState.CONNECTED,
            ConnectionState.RECONNECTING -> {
                ActiveControlScreen(
                    connectionState = connectionState,
                    lastCommand = lastCommand,
                    onDisconnect = onDisconnect,
                    onWriteCommand = onWriteCommand
                )
            }
        }
    }
}

@Composable
fun PermissionRequiredScreen(
    onRequest: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0B0F))
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Info,
            contentDescription = null,
            tint = Color(0xFFFF416C),
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "Bluetooth Permissions Required",
            color = Color.White,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.SansSerif
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "To search and pair with the ESP32 light strip controller, Android requires proximity/scanning permissions of local devices.",
            color = Color(0xFFA0A0C0),
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
            fontFamily = FontFamily.SansSerif,
            modifier = Modifier.padding(horizontal = 16.dp)
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onRequest,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E5CFF)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().height(48.dp)
        ) {
            Text("Grant BLE Permissions", color = Color.White, fontWeight = FontWeight.SemiBold)
        }
        Spacer(modifier = Modifier.height(12.dp))
        TextButton(onClick = onOpenSettings) {
            Text("Open App System Settings", color = Color(0xFF8080FF))
        }
    }
}

@Composable
fun BluetoothRequiredScreen(
    onEnable: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0B0F))
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Bluetooth Disabled",
            color = Color.White,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Please turn on your smartphone's Bluetooth antenna to connect to 'ESP32-RGB-Light'.",
            color = Color(0xFFA0A0C0),
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp)
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onEnable,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E5CFF)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().height(48.dp)
        ) {
            Text("Power On Bluetooth", color = Color.White)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    scannedDevices: List<BluetoothDevice>,
    isScanning: Boolean,
    onStartScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (BluetoothDevice) -> Unit
) {
    // Start scan automatically on screen enter
    LaunchedEffect(Unit) {
        onStartScan()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0B0F))
            .padding(16.dp)
    ) {
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "ESP32 Controller",
            color = Color.White,
            fontSize = 28.sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.padding(bottom = 4.dp)
        )
        Text(
            text = "Select your hardware node to connect",
            color = Color(0xFF6C6C80),
            fontSize = 14.sp,
            modifier = Modifier.padding(bottom = 24.dp)
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (isScanning) "Searching for ESP32-RGB-Light..." else "Scan Stopped",
                color = Color(0xFFA0A0AF),
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium
            )
            IconButton(
                onClick = { if (isScanning) onStopScan() else onStartScan() },
                modifier = Modifier.background(Color(0xFF181820), CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = "Scan",
                    tint = if (isScanning) Color(0xFF1E5CFF) else Color.White
                )
            }
        }

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF08080C))
                .border(1.dp, Color(0xFF1A1A24), RoundedCornerShape(16.dp))
        ) {
            if (scannedDevices.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    CircularProgressIndicator(
                        color = Color(0xFF1E5CFF),
                        strokeWidth = 3.dp,
                        modifier = Modifier.size(36.dp)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Searching...",
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Ensure the ESP32 light strip is powered on, advertise mode is active, and not already paired.",
                        color = Color(0xFF6A6A80),
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center
                    )
                }
            } else {
                LazyColumn {
                    items(scannedDevices) { device ->
                        ScanDeviceItem(
                            device = device,
                            onConnect = { onConnect(device) }
                        )
                    }
                }
            }
        }
    }
}

@SuppressLint("MissingPermission")
@Composable
fun ScanDeviceItem(
    device: BluetoothDevice,
    onConnect: () -> Unit
) {
    Card(
        onClick = onConnect,
        modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF12121A)),
        border = BorderStroke(1.dp, Color(0xFF1E1E2C)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = device.name ?: "Unknown ESP32",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = device.address,
                    color = Color(0xFF8E8E9F),
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )
            }
            Box(
                modifier = Modifier
                    .background(Color(0xFF1E5CFF).copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    text = "Connect",
                    color = Color(0xFF6B8EFF),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

@Composable
fun ActiveControlScreen(
    connectionState: ConnectionState,
    lastCommand: String,
    onDisconnect: () -> Unit,
    onWriteCommand: (String) -> Unit
) {
    var powerState by remember { mutableStateOf(true) }
    var rawColor by remember { mutableStateOf(Color.Magenta) }
    var brightness by remember { mutableStateOf(200f) }
    var selectedEffect by remember { mutableStateOf(1) } // 0=Off, 1=Solid, 2=Rainbow, 3=Breathe, 4=Chase

    // Soft animated pulse for the glow visualizer
    val infiniteTransition = rememberInfiniteTransition()
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 0.85f,
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        )
    )

    // Calculate actual active visual colors
    val finalColor = if (powerState) {
        val calculatedBr = brightness / 255f
        rawColor.copy(alpha = calculatedBr)
    } else {
        Color.DarkGray.copy(alpha = 0.2f)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0B0F))
            .padding(16.dp)
    ) {
        // Top Connection Status Header
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .background(
                                color = when (connectionState) {
                                    ConnectionState.CONNECTED -> Color(0xFF4CDC75)
                                    ConnectionState.RECONNECTING -> Color(0xFFFFB800)
                                    else -> Color.Red
                                },
                                shape = CircleShape
                            )
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = when (connectionState) {
                            ConnectionState.CONNECTED -> "ESP32-RGB-Light Connected"
                            ConnectionState.RECONNECTING -> "Reconnecting..."
                            else -> "Connecting..."
                        },
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Text(
                    text = "GATT Service (19b10000)",
                    color = Color(0xFF6C6C80),
                    fontSize = 11.sp
                )
            }
            TextButton(
                onClick = onDisconnect,
                colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFFFF5252))
            ) {
                Text("Disconnect", fontWeight = FontWeight.Bold)
            }
        }

        // Central Orb (Main Piece)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp),
            contentAlignment = Alignment.Center
        ) {
            // Shadow Blur Layer
            Box(
                modifier = Modifier
                    .size(110.dp)
                    .blur(28.dp)
                    .background(finalColor.copy(alpha = finalColor.alpha * pulseAlpha), CircleShape)
            )
            // Foreground Solid/Glass Circle
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .background(finalColor, CircleShape)
                    .border(2.dp, Color.White.copy(alpha = 0.15f), CircleShape)
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Power Toggle Row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF12121A))
                .border(1.dp, Color(0xFF1E1E2C), RoundedCornerShape(16.dp))
                .padding(14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "System Output Power",
                color = Color.White,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp
            )
            Switch(
                checked = powerState,
                onCheckedChange = { isChecked ->
                    powerState = isChecked
                    onWriteCommand("POWER:\${if (isChecked) 1 else 0}")
                    if (!isChecked) {
                        selectedEffect = 0
                    } else if (selectedEffect == 0) {
                        selectedEffect = 1
                    }
                },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Color.White,
                    checkedTrackColor = Color(0xFF1E5CFF)
                )
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Color Wheel Panel (HSV Selection Widget)
        if (powerState && selectedEffect == 1) {
            Spacer(modifier = Modifier.height(4.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1.5f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xFF12121A))
                    .border(1.dp, Color(0xFF1E1E2C), RoundedCornerShape(16.dp))
                    .padding(14.dp),
                contentAlignment = Alignment.Center
            ) {
                ColorWheelWidget { color ->
                    rawColor = color
                    val r = (color.red * 255).toInt()
                    val g = (color.green * 255).toInt()
                    val b = (color.blue * 255).toInt()
                    onWriteCommand("COLOR:\$r,\$g,\$b")
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Brightness Control
        if (powerState) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xFF12121A))
                    .border(1.dp, Color(0xFF1E1E2C), RoundedCornerShape(16.dp))
                    .padding(14.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Controller Brightness", color = Color.White, fontSize = 14.sp)
                    Text("\${brightness.toInt()}/255", color = Color(0xFF8E8E9F), fontSize = 14.sp, fontFamily = FontFamily.Monospace)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Slider(
                    value = brightness,
                    valueRange = 0f..255f,
                    onValueChange = { value ->
                        brightness = value
                        // Can be throttled to 100ms in actual handler
                    },
                    onValueChangeFinished = {
                        onWriteCommand("BRIGHT:\${brightness.toInt()}")
                    },
                    colors = SliderDefaults.colors(
                        activeTrackColor = Color(0xFF1E5CFF),
                        inactiveTrackColor = Color(0xFF2E2E3A),
                        thumbColor = Color.White
                    )
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Effects Selection List
        Text(
            text = "Active Strip Presets",
            color = Color(0xFF8E8E9F),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            val chips = listOf("Off", "Solid", "Rainbow", "Breathe", "Chase")
            chips.forEachIndexed { index, name ->
                val isSelected = selectedEffect == index
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isSelected) Color(0xFF1E5CFF) else Color(0xFF12121A))
                        .border(1.dp, if (isSelected) Color.Transparent else Color(0xFF1E1E2C), RoundedCornerShape(10.dp))
                        .clickable {
                            selectedEffect = index
                            if (index == 0) {
                                powerState = false
                                onWriteCommand("POWER:0")
                            } else {
                                powerState = true
                                onWriteCommand("POWER:1")
                                onWriteCommand("EFFECT:\$index")
                            }
                        }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = name,
                        color = if (isSelected) Color.White else Color(0xFF8E8E9F),
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                    )
                }
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        // Debug Command Console Output Line
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0xFF070709))
                .padding(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "DEBUG:",
                    color = Color(0xFFFF416C),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (lastCommand.isEmpty()) "Await commands..." else lastCommand,
                    color = Color(0xFF4CDC75),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp
                )
            }
        }
    }
}

@Composable
fun ColorWheelWidget(onColorSelected: (Color) -> Unit) {
    var sweepAngle by remember { mutableStateOf(0f) }
    var radiusFraction by remember { mutableStateOf(0.7f) }

    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectDragGestures { change, dragAmount ->
                    change.consume()
                    val centerX = size.width / 2f
                    val centerY = size.height / 2f
                    val pos = change.position
                    val dx = pos.x - centerX
                    val dy = pos.y - centerY
                    val angleRad = atan2(dy, dx)
                    
                    var deg = Math.toDegrees(angleRad.toDouble()).toFloat()
                    if (deg < 0) deg += 360f
                    sweepAngle = deg

                    val dist = sqrt(dx*dx + dy*dy)
                    val maxRadius = size.width.coerceAtMost(size.height) / 2f
                    radiusFraction = (dist / maxRadius).coerceIn(0f, 1f)

                    val color = hsvToColor(sweepAngle, radiusFraction, 1.0f)
                    onColorSelected(color)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures { offset ->
                    val centerX = size.width / 2f
                    val centerY = size.height / 2f
                    val dx = offset.x - centerX
                    val dy = offset.y - centerY
                    val angleRad = atan2(dy, dx)
                    
                    var deg = Math.toDegrees(angleRad.toDouble()).toFloat()
                    if (deg < 0) deg += 360f
                    sweepAngle = deg

                    val dist = sqrt(dx*dx + dy*dy)
                    val maxRadius = size.width.coerceAtMost(size.height) / 2f
                    radiusFraction = (dist / maxRadius).coerceIn(0f, 1f)

                    val color = hsvToColor(sweepAngle, radiusFraction, 1.0f)
                    onColorSelected(color)
                }
            }
    ) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val outerRadius = size.width.coerceAtMost(size.height) / 2f

        // Draw RGB angular wheel representation
        val colors = listOf(Color.Red, Color.Yellow, Color.Green, Color.Cyan, Color.Blue, Color.Magenta, Color.Red)
        val brush = Brush.sweepGradient(colors, center)
        drawCircle(brush, radius = outerRadius, center = center)

        // Draw Saturation radial cover-wash
        val washBrush = Brush.radialGradient(
            colors = listOf(Color.White, Color.Transparent),
            center = center,
            radius = outerRadius
        )
        drawCircle(washBrush, radius = outerRadius, center = center)

        // Draw user cursor locator pin
        val cursorAngleRad = Math.toRadians(sweepAngle.toDouble())
        val cursorRadius = outerRadius * radiusFraction
        val cx = center.x + (cursorRadius * cos(cursorAngleRad)).toFloat()
        val cy = center.y + (cursorRadius * sin(cursorAngleRad)).toFloat()

        drawCircle(
            color = Color.Black,
            radius = 12.dp.toPx(),
            center = Offset(cx, cy),
            style = Stroke(width = 3.dp.toPx())
        )
        drawCircle(
            color = Color.White,
            radius = 10.dp.toPx(),
            center = Offset(cx, cy)
        )
    }
}

// Low level color mapping function
fun hsvToColor(hue: Float, saturation: Float, value: Float): Color {
    val c = value * saturation
    val x = c * (1 - kotlin.math.abs((hue / 60f) % 2 - 1))
    val m = value - c

    val (r, g, b) = when {
        hue < 60 -> Triple(c, x, 0f)
        hue < 120 -> Triple(x, c, 0f)
        hue < 180 -> Triple(0f, c, x)
        hue < 240 -> Triple(0f, x, c)
        hue < 300 -> Triple(x, 0f, c)
        else -> Triple(c, 0f, x)
    }

    return Color(r + m, g + m, b + m)
}
`
  },
  {
    name: "Theme.kt",
    path: "app/src/main/java/com/example/esp32rgb/ui/theme/Theme.kt",
    language: "kotlin",
    content: `package com.example.esp32rgb.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF1E5CFF),
    secondary = Color(0xFF12121A),
    background = Color(0xFF0B0B0F),
    surface = Color(0xFF12121A),
    onPrimary = Color.White,
    onBackground = Color.White,
    onSurface = Color.White
)

@Composable
fun ESP32RGBControllerTheme(
    content: @Composable () -> Unit
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = Color(0xFF0B0B0F).toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = MaterialTheme.typography,
        content = content
    )
}
`
  },
  {
    name: "AndroidManifest.xml",
    path: "app/src/main/AndroidManifest.xml",
    language: "xml",
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Standard Bluetooth Permissions -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

    <!-- Android 12 (API 31+) Scan and Connect Core Perms -->
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" 
        android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

    <!-- Location required for BLE scanning below API 31 -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

    <!-- Declares BLE requirement -->
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="ESP32 RGB Controller"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="portrait"
            android:theme="@style/Theme.AppCompat.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`
  },
  {
    name: "build.gradle.kts",
    path: "app/build.gradle.kts",
    language: "gradle",
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.example.esp32rgb"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.esp32rgb"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.1"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    
    // Compose
    implementation(platform("androidx.compose:compose-bom:2023.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Coroutines Thread bindings
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
`
  }
];
