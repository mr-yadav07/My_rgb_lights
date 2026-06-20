package com.example.esp32rgb.ui.screens

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
                    val center = size.div(2f)
                    val pos = change.position
                    val dx = pos.x - center.width
                    val dy = pos.y - center.height
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
                    val center = size.div(2f)
                    val dx = offset.x - center.width
                    val dy = offset.y - center.height
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
