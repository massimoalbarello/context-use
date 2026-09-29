cmake_minimum_required(VERSION 3.24)
project(context_use_media_build LANGUAGES C)
include(ExternalProject)
find_program(MAKE_EXECUTABLE make REQUIRED)
set(dependencies ${CMAKE_BINARY_DIR}/dependencies)
ExternalProject_Add(webp
  URL https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz
  URL_HASH SHA256=e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564
  CMAKE_ARGS -DCMAKE_INSTALL_PREFIX=${dependencies} -DCMAKE_BUILD_TYPE=MinSizeRel
    -DBUILD_SHARED_LIBS=OFF -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF
    -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF
    -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF
    -DWEBP_BUILD_EXTRAS=OFF
  BUILD_COMMAND ${CMAKE_COMMAND} --build <BINARY_DIR> --parallel 2)
ExternalProject_Add(media-preview
  DEPENDS webp
  URL https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
  URL_HASH SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
  CONFIGURE_COMMAND ${CMAKE_COMMAND} -E env PKG_CONFIG_PATH=${dependencies}/lib/pkgconfig
    <SOURCE_DIR>/configure --prefix=${CMAKE_BINARY_DIR}/runtime
    --disable-autodetect --disable-doc --disable-debug --disable-network --disable-everything
    --disable-x86asm --disable-avdevice --disable-swresample --disable-ffplay --disable-ffprobe
    --enable-small --enable-ffmpeg --enable-protocol=file --enable-libwebp --enable-zlib
    --enable-decoder=mjpeg,png,webp,gif,bmp,tiff,h264,hevc,vp8,vp9,av1,mpeg4
    --enable-demuxer=image2,image_jpeg_pipe,image_png_pipe,image_webp_pipe,image_bmp_pipe,image_tiff_pipe,gif,mov,matroska,avi
    --enable-parser=mjpeg,png,webp,h264,hevc,vp8,vp9,av1,mpeg4video
    --enable-encoder=libwebp --enable-muxer=webp
    --enable-filter=scale,format,transpose,hflip,vflip,null
    --pkg-config-flags=--static --extra-ldflags=${CMAKE_EXE_LINKER_FLAGS}
  BUILD_COMMAND ${MAKE_EXECUTABLE} -j2
  INSTALL_COMMAND ${MAKE_EXECUTABLE} install)
