FROM alpine:3.21 AS build
RUN apk add --no-cache build-base cmake linux-headers curl
WORKDIR /source
COPY apps/backend/native/faces/ ./
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS=-static \
 && cmake --build build --target face-analyzer -j2 \
 && strip build/runtime/face-analyzer
FROM scratch
COPY --from=build /source/build/runtime/face-analyzer /face-analyzer
