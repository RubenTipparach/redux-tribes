using UnityEngine;

[CreateAssetMenu(fileName = "ButtonColorProperties", menuName = "Overlay/ButtonColorProperties", order = 0)]
public class ButtonColorProperties : ScriptableObject {
    public Color unselectedColor;
    public Color selectedColor;
}