package com.example.esp32rgb

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
