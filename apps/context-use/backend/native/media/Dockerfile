FROM alpine:3.21 AS build
RUN apk add --no-cache build-base cmake linux-headers curl pkgconf zlib-dev zlib-static
WORKDIR /source
COPY apps/context-use/backend/native/media/ ./
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS=-static \
 && cmake --build build --target media-preview -j2 \
 && strip build/runtime/bin/ffmpeg
FROM scratch
COPY --from=build /source/build/runtime/bin/ffmpeg /ffmpeg
