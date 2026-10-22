# 자료 출처와 해석 범위

- 원안과 입력: 사용자가 제공한 전문가 검토 전 D-A-A LOOP Ion Mill 프로그램 및 PHM2018_DAA_Student_REAL_01_M02 학생용 추출 자료.
- 공개 원자료의 장비·센서 설명: https://phmsociety.org/conference/annual-conference-of-the-phm-society/annual-conference-of-the-prognostics-and-health-management-society-2018-b/phm-data-challenge-6/
- 알고리즘 설명: https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html
- assets/data: 학생용 Colab v4를 제공 입력으로 실제 실행한 점수·모델 설명·A/B 사례. 정확한 실행 환경과 기준은 model_summary.json 참조.
- index.html의 가상 점수: 세 구간과 안전 절차를 가르치는 자체 제작 예시. 실제 센서 측정이나 고장 정답이 아님.
- assets/figures: 이 수업을 위한 자체 제작 개념도. F10은 실제 실행 점수 그래프. 구조·축척·배선을 실제 장비 설계도로 해석하지 않음.

학습 파일 6000행 중 4399행이 Validation 시작시각 이후 또는 같은 시각에 있습니다. Validation과 같은 운전조건이며 그보다 앞선 학습 기록은 6행뿐입니다. 이번 실행은 원안을 유지하는 RETROSPECTIVE 해석으로, 시간순 미래 고장 예측 성능 검증이 아닙니다. 원본에서 적절한 비교 구간을 새로 확보하기 전에는 정확도·미탐지율·고장 확률을 주장하지 않습니다.

원안과 데이터의 기존 이용조건은 유지됩니다. 이 묶음은 데이터에 새로운 재배포 허가나 전체 소프트웨어의 새 라이선스를 부여하지 않습니다. 포함된 PapaParse의 고지는 THIRD_PARTY_NOTICES.txt에 있습니다.
