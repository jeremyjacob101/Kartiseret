plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.jj.kartiseret"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.jj.kartiseret"
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "API_BASE_URL", "\"https://seret.site\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"\"")
        buildConfigField("String", "APP_LINK_HOST", "\"seret.site\"")
        manifestPlaceholders["appLinkHost"] = "seret.site"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    flavorDimensions += "environment"
    productFlavors {
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            buildConfigField("String", "API_BASE_URL", "\"${providers.gradleProperty("KARTISERET_STAGING_API_BASE_URL").orNull ?: "https://staging.seret.site"}\"")
            buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${providers.gradleProperty("KARTISERET_GOOGLE_WEB_CLIENT_ID").orNull ?: ""}\"")
            buildConfigField("String", "APP_LINK_HOST", "\"${providers.gradleProperty("KARTISERET_STAGING_LINK_HOST").orNull ?: "staging.seret.site"}\"")
            manifestPlaceholders["appLinkHost"] = providers.gradleProperty("KARTISERET_STAGING_LINK_HOST").orNull ?: "staging.seret.site"
        }
        create("production") { dimension = "environment" }
        create("fixture") {
            dimension = "environment"
            applicationIdSuffix = ".fixture"
            buildConfigField("String", "API_BASE_URL", "\"https://seret.site\"")
            buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"\"")
            buildConfigField("String", "APP_LINK_HOST", "\"invalid.local\"")
            manifestPlaceholders["appLinkHost"] = "invalid.local"
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // 1.9.x remains compatible with this module's AGP 8.13 / compileSdk 36.
    val composeBom = platform("androidx.compose:compose-bom:2025.10.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.12.0")
    implementation("androidx.browser:browser:1.10.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.9.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
