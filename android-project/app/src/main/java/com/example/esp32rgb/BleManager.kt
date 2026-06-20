package com.example.esp32rgb

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
